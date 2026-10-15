"""REST 端点（/api/v1）。见设计文档 §8.1。"""
import asyncio
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select, text, update

from app.core.config import FILES_DIR
from app.core.db import SessionLocal, VEC_AVAILABLE
from app.core.security import encrypt
from app.models import (AITask, Answer, Attempt, Chapter, ChapterChunk, Course, Exercise,
                        LessonPlan, Message, Model, Paper, PaperQuestion, Session,
                        Setting, Summary, Textbook)
from app.schemas import (ChatIn, ChapterUpdate, ChapterOut, ChapterDetail, ChunkOut,
                         CourseCreate, CourseOut, CourseUpdate, ExerciseGenerate,
                         ExerciseOut, ExerciseUpdate, ModelCreate, ModelOut,
                         ModelTestResult, ModelUpdate, PaperCreate, SearchResult, SessionCreate,
                         SessionOut, MessageOut, SummaryGenerate, SummaryOut,
                         TaskOut, TextbookImport, TextbookOut)
from app.services import ai, indexing, parsing
from app.services.jobs import jobs
from app.services.llm import test_connectivity

router = APIRouter()


def _uid() -> str:
    return uuid.uuid4().hex


def _err(code: str, msg: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": {"code": code, "message": msg}})


# ============ 健康检查 ============
@router.get("/health")
def health():
    return {"status": "ok", "vec": VEC_AVAILABLE, "time": datetime.utcnow().isoformat()}


# ============ 课程 ============
@router.get("/courses", response_model=list[CourseOut])
def list_courses():
    with SessionLocal() as db:
        return list(db.scalars(select(Course).order_by(Course.created_at.desc())))


@router.post("/courses", response_model=CourseOut, status_code=201)
def create_course(body: CourseCreate):
    with SessionLocal() as db:
        row = Course(id=_uid(), **body.model_dump())
        db.add(row)
        db.commit()
        db.refresh(row)
        return row


@router.patch("/courses/{course_id}", response_model=CourseOut)
def update_course(course_id: str, body: CourseUpdate):
    with SessionLocal() as db:
        row = db.get(Course, course_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"课程不存在: {course_id}", 404)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(row, k, v)
        db.commit()
        db.refresh(row)
        return row


@router.post("/courses/{course_id}/archive")
def archive_course(course_id: str):
    with SessionLocal() as db:
        row = db.get(Course, course_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"课程不存在: {course_id}", 404)
        row.status = "archived" if row.status == "active" else "active"
        db.commit()
        return {"status": row.status}


@router.delete("/courses/{course_id}", status_code=204)
def delete_course(course_id: str):
    with SessionLocal() as db:
        row = db.get(Course, course_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"课程不存在: {course_id}", 404)
        db.delete(row)
        db.commit()


# ============ 教材导入 ============
@router.post("/textbooks/import", response_model=TaskOut, status_code=202)
def import_textbook(body: TextbookImport):
    src = Path(body.file_path)
    if not src.exists():
        raise _err("E_FILE_NOT_FOUND", f"文件不存在: {body.file_path}")
    file_type = (body.file_type or src.suffix.lower().lstrip("."))
    if file_type not in ("pdf", "docx", "md", "markdown", "txt", "epub"):
        raise _err("E_UNSUPPORTED", f"不支持的类型 .{file_type}")
    # 复制到应用数据目录
    dest = FILES_DIR / f"{_uid()}.{file_type}"
    shutil.copy2(src, dest)
    return _start_import_task(body.course_id, dest, file_type,
                              body.title, body.passphrase)


@router.post("/textbooks/upload", response_model=TaskOut, status_code=202)
async def upload_textbook(
    course_id: str = Form(...),
    title: str | None = Form(None),
    passphrase: str | None = Form(None),
    file: UploadFile = File(...),
):
    """浏览器模式教材导入：multipart 上传文件（桌面模式请用 /import，本地路径直传）。"""
    file_type = (file.filename or "").rsplit(".", 1)[-1].lower()
    if file_type not in ("pdf", "docx", "md", "markdown", "txt", "epub"):
        raise _err("E_UNSUPPORTED", f"不支持的类型 .{file_type}")
    with SessionLocal() as db:
        if db.get(Course, course_id) is None:
            raise _err("E_NOT_FOUND", f"课程不存在: {course_id}", 404)
    # 教材名以原始文件名命名
    original = (file.filename or "").strip()
    dest = FILES_DIR / f"{_uid()}.{file_type}"
    dest.write_bytes(await file.read())
    return _start_import_task(course_id, dest, file_type,
                              title or Path(original).stem, passphrase)


def _start_import_task(course_id: str, dest: Path, file_type: str,
                       title: str | None, passphrase: str | None) -> AITask:
    """公共逻辑：登记教材记录并提交解析任务（import / upload 共用）。"""
    with SessionLocal() as db:
        course = db.get(Course, course_id)
        if course is None:
            raise _err("E_NOT_FOUND", f"课程不存在: {course_id}", 404)
        title = title or dest.stem
        row = Textbook(id=_uid(), course_id=course_id, title=title,
                       file_path=str(dest), file_type=file_type,
                       file_hash=parsing.file_hash(str(dest)),
                       status="pending",
                       file_passphrase_enc=encrypt(passphrase) if passphrase else None)
        db.add(row)
        db.commit()
        textbook_id = row.id
        params = {"textbook_id": textbook_id, "title": title, "passphrase": passphrase}
        job = jobs.create("教材导入", params, lambda j: _run_import(j, textbook_id, passphrase))
        return _job_to_task(job)


async def _run_import(job, textbook_id: str, passphrase: str | None = None) -> str:
    with SessionLocal() as db:
        tb = db.get(Textbook, textbook_id)
        tb.status = "parsing"
        db.commit()
        try:
            result = parsing.extract(tb.file_path, tb.file_type)
        except parsing.ParseError as e:
            tb.status = "failed"
            tb.error = str(e)
            db.commit()
            raise
        tb.page_count = len([1 for p, _ in result.pages if p is not None]) or 0
        tb.word_count = result.word_count
        job.set_progress(10, f"文本抽取完成（{result.word_count} 字）")
        # 结构识别
        sections = parsing.build_chapter_tree(result)
        tb.structure_source = sections[0]["structure"] if sections else "auto"
        job.set_progress(25, f"结构识别：{len(sections)} 章（{tb.structure_source}）")
        # 生成章节树
        root_chapters = []
        for sec in sections:
            ch = Chapter(id=_uid(), textbook_id=textbook_id, parent_id=None,
                         title=sec["title"], level=sec["level"],
                         path=sec["title"],
                         page_start=sec.get("page_start"), page_end=sec.get("page_end"),
                         word_count=len(sec["text"]), content=sec["text"],
                         structure=sec["structure"])
            db.add(ch)
            root_chapters.append(ch)
        db.commit()
        job.set_progress(40, "章节树已生成，待确认")
        # 分段 + 索引（FTS；向量化取决于用户是否配置嵌入模型）
        total = len(root_chapters)
        for i, ch in enumerate(root_chapters):
            job.check_cancelled()
            n = await indexing.rebuild_chapter_index(ch.id, job)
            job.set_progress(40 + (i / total) * 55,
                             f"索引第 {i + 1}/{total} 章（{n} 段）")
        tb.status = "parsed"
        db.commit()
        job.set_progress(100, f"导入完成：{total} 章")
        return textbook_id


@router.get("/textbooks", response_model=list[TextbookOut])
def list_textbooks(course_id: str | None = None):
    with SessionLocal() as db:
        q = select(Textbook)
        if course_id:
            q = q.where(Textbook.course_id == course_id)
        return list(db.scalars(q.order_by(Textbook.created_at.desc())))


@router.get("/textbooks/{textbook_id}", response_model=TextbookOut)
def get_textbook(textbook_id: str):
    with SessionLocal() as db:
        row = db.get(Textbook, textbook_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"教材不存在: {textbook_id}", 404)
        return row


@router.delete("/textbooks/{textbook_id}", status_code=204)
def delete_textbook(textbook_id: str):
    """删除教材及其章节、摘要、教案与索引（题目转孤立后保留）。"""
    with SessionLocal() as db:
        row = db.get(Textbook, textbook_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"教材不存在: {textbook_id}", 404)
        chapter_ids = [c.id for c in db.scalars(
            select(Chapter).where(Chapter.textbook_id == textbook_id))]
        # 同一会话内清理索引（跨会话调用会因写锁失败而留下孤儿 FTS 行）
        if chapter_ids:
            ph = ",".join(f":i{n}" for n in range(len(chapter_ids)))
            bind = {f"i{n}": cid for n, cid in enumerate(chapter_ids)}
            db.execute(text(f"DELETE FROM chapter_fts WHERE chapter_id IN ({ph})"), bind)
            if VEC_AVAILABLE:
                db.execute(text(
                    f"DELETE FROM vec_chunks WHERE chunk_id IN "
                    f"(SELECT id FROM chapter_chunks WHERE chapter_id IN ({ph}))"), bind)
            db.execute(delete(ChapterChunk).where(
                ChapterChunk.chapter_id.in_(chapter_ids)))
        for cid in chapter_ids:
            db.execute(delete(Summary).where(Summary.chapter_id == cid))
            db.execute(delete(LessonPlan).where(LessonPlan.chapter_id == cid))
            # 题目保留但解除章节归属（题库独立于教材）
            db.execute(update(Exercise).where(Exercise.chapter_id == cid)
                       .values(chapter_id=None))
        db.execute(delete(Chapter).where(Chapter.textbook_id == textbook_id))
        db.delete(row)
        db.commit()
        return None


@router.get("/textbooks/{textbook_id}/chapters", response_model=list[ChapterOut])
def get_chapters(textbook_id: str):
    with SessionLocal() as db:
        rows = list(db.scalars(select(Chapter).where(Chapter.textbook_id == textbook_id)
                               .order_by(Chapter.path)))
        return rows


# ============ 章节 ============
@router.get("/chapters/{chapter_id}", response_model=ChapterDetail)
def get_chapter(chapter_id: str):
    with SessionLocal() as db:
        ch = db.get(Chapter, chapter_id)
        if ch is None:
            raise _err("E_NOT_FOUND", f"章节不存在: {chapter_id}", 404)
        chunks = list(db.scalars(select(ChapterChunk).where(ChapterChunk.chapter_id == chapter_id)
                                 .order_by(ChapterChunk.id)))
        detail = ChapterDetail.model_validate(ch)
        detail.chunks = [ChunkOut.model_validate(c) for c in chunks]
        return detail


@router.patch("/chapters/{chapter_id}", response_model=ChapterOut)
def update_chapter(chapter_id: str, body: ChapterUpdate):
    with SessionLocal() as db:
        ch = db.get(Chapter, chapter_id)
        if ch is None:
            raise _err("E_NOT_FOUND", f"章节不存在: {chapter_id}", 404)
        data = body.model_dump(exclude_unset=True)
        for k, v in data.items():
            setattr(ch, k, v)
        db.commit()
        db.refresh(ch)
        return ch


@router.post("/chapters/{chapter_id}/revector", response_model=TaskOut, status_code=202)
def revector_chapter(chapter_id: str):
    with SessionLocal() as db:
        ch = db.get(Chapter, chapter_id)
        if ch is None:
            raise _err("E_NOT_FOUND", f"章节不存在: {chapter_id}", 404)
        job = jobs.create("章节向量化", {"chapter_id": chapter_id},
                          lambda j: _run_revector(j, chapter_id))
        return _job_to_task(job)


async def _run_revector(job, chapter_id: str) -> str:
    n = await indexing.rebuild_chapter_index(chapter_id, job)
    job.set_progress(100, f"完成（{n} 段）")
    return chapter_id


# ============ 搜索 ============
@router.get("/search", response_model=list[SearchResult])
async def search(q: str = "", scope: str | None = None, k: int = 8):
    if not q.strip():
        return []
    chapter_ids = None
    if scope and scope != "all":
        chapter_ids = [s for s in scope.split(",") if s]
    return await indexing.hybrid_search(q, chapter_ids, k=k)


# ============ 章节总结 ============
@router.post("/summaries/generate", response_model=TaskOut, status_code=202)
def generate_summary(body: SummaryGenerate):
    with SessionLocal() as db:
        ch = db.get(Chapter, body.chapter_id)
        if ch is None:
            raise _err("E_NOT_FOUND", f"章节不存在: {body.chapter_id}", 404)
        job = jobs.create("章节总结", {"chapter_id": body.chapter_id},
                          lambda j: ai.generate_summary(j, body.chapter_id, body.model_id),
                          model_id=body.model_id or "")
        return _job_to_task(job)


@router.get("/chapters/{chapter_id}/summaries", response_model=list[SummaryOut])
def list_summaries(chapter_id: str):
    with SessionLocal() as db:
        return list(db.scalars(select(Summary).where(Summary.chapter_id == chapter_id)
                               .order_by(Summary.version.desc())))


# ============ 习题 ============
@router.post("/exercises/generate", response_model=TaskOut, status_code=202)
def generate_exercises(body: ExerciseGenerate):
    with SessionLocal() as db:
        course = db.get(Course, body.course_id)
        if course is None:
            raise _err("E_NOT_FOUND", f"课程不存在: {body.course_id}", 404)
        params = body.model_dump()
        job = jobs.create("出题", params,
                          lambda j: ai.generate_exercises(j, params),
                          model_id=body.model_id or "")
        return _job_to_task(job)


@router.get("/exercises", response_model=list[ExerciseOut])
def list_exercises(course_id: str | None = None, chapter_id: str | None = None,
                   status: str | None = None, type: str | None = None):
    with SessionLocal() as db:
        q = select(Exercise)
        if course_id:
            q = q.where(Exercise.course_id == course_id)
        if chapter_id:
            q = q.where(Exercise.chapter_id == chapter_id)
        if status:
            q = q.where(Exercise.status == status)
        if type:
            q = q.where(Exercise.type == type)
        return list(db.scalars(q.order_by(Exercise.created_at.desc()).limit(500)))


@router.patch("/exercises/{exercise_id}", response_model=ExerciseOut)
def update_exercise(exercise_id: str, body: ExerciseUpdate):
    with SessionLocal() as db:
        row = db.get(Exercise, exercise_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"题目不存在: {exercise_id}", 404)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(row, k, v)
        db.commit()
        db.refresh(row)
        return row


@router.delete("/exercises/{exercise_id}", status_code=204)
def delete_exercise(exercise_id: str):
    with SessionLocal() as db:
        row = db.get(Exercise, exercise_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"题目不存在: {exercise_id}", 404)
        db.delete(row)
        db.commit()


# ============ 测验（P0：客观题自动判分，主观题留待 AI 阅卷 P2） ============
@router.post("/papers", status_code=201)
def create_paper(body: PaperCreate):
    import random
    with SessionLocal() as db:
        ids = list(body.exercise_ids)
        if body.shuffle:
            rnd = random.Random(body.seed)
            rnd.shuffle(ids)
        total = 0
        paper = Paper(id=_uid(), course_id=body.course_id, title=body.title,
                      duration_min=body.duration_min,
                      config={"shuffle": body.shuffle, "seed": body.seed})
        db.add(paper)
        db.commit()
        for i, eid in enumerate(ids, 1):
            ex = db.get(Exercise, eid)
            if ex is None:
                continue
            score = 10
            total += score
            db.add(PaperQuestion(paper_id=paper.id, exercise_id=eid, order=i, score=score))
        paper.total_score = total
        db.commit()
        return {"id": paper.id, "total_score": total, "count": len(ids)}


@router.post("/papers/{paper_id}/attempts", status_code=201)
def start_attempt(paper_id: str):
    with SessionLocal() as db:
        paper = db.get(Paper, paper_id)
        if paper is None:
            raise _err("E_NOT_FOUND", f"试卷不存在: {paper_id}", 404)
        attempt = Attempt(id=_uid(), paper_id=paper_id,
                          config_snapshot={"duration_min": paper.duration_min})
        db.add(attempt)
        db.commit()
        return {"id": attempt.id, "duration_min": paper.duration_min}


@router.get("/papers/{paper_id}")
def get_paper(paper_id: str):
    with SessionLocal() as db:
        paper = db.get(Paper, paper_id)
        if paper is None:
            raise _err("E_NOT_FOUND", f"试卷不存在: {paper_id}", 404)
        rows = list(db.scalars(select(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                               .order_by(PaperQuestion.order)))
        questions = []
        for pq in rows:
            ex = db.get(Exercise, pq.exercise_id)
            questions.append({
                "order": pq.order, "score": pq.score,
                "exercise_id": ex.id, "type": ex.type, "stem": ex.stem,
                "options": ex.options, "difficulty": ex.difficulty,
            })
        return {"id": paper.id, "title": paper.title, "duration_min": paper.duration_min,
                "total_score": paper.total_score, "questions": questions}


@router.post("/attempts/{attempt_id}/submit")
def submit_attempt(attempt_id: str, answers: dict[str, str]):
    """提交答卷：客观题规则判分（归一化精确匹配）；主观题标记待阅卷。"""
    with SessionLocal() as db:
        attempt = db.get(Attempt, attempt_id)
        if attempt is None:
            raise _err("E_NOT_FOUND", f"作答记录不存在: {attempt_id}", 404)
        total = 0
        pqs = list(db.scalars(select(PaperQuestion).where(PaperQuestion.paper_id == attempt.paper_id)
                              .order_by(PaperQuestion.order)))
        for pq in pqs:
            ex = db.get(Exercise, pq.exercise_id)
            raw = answers.get(ex.id, "")
            ans = Answer(id=_uid(), attempt_id=attempt_id, question_id=ex.id, content=raw)
            if ex.type in ("single", "judge"):
                norm = lambda s: str(s).strip().split(".")[-1].strip() if "." in str(s) else str(s).strip()
                correct = norm(raw) == norm(ex.answer)
                ans.is_correct = correct
                ans.ai_score = pq.score if correct else 0
                ans.ai_feedback = {"auto": True, "correct": correct,
                                   "reference": ex.answer, "explanation": ex.explanation}
                total += ans.ai_score
            elif ex.type == "multi":
                picked = sorted(str(raw).split(",")) if raw else []
                expected = sorted(str(ex.answer).split(","))
                correct = picked == expected
                ans.is_correct = correct
                ans.ai_score = pq.score if correct else 0
                ans.ai_feedback = {"auto": True, "correct": correct,
                                   "reference": ex.answer, "explanation": ex.explanation}
                total += ans.ai_score
            else:
                ans.is_correct = None
                ans.ai_score = None
                ans.ai_feedback = {"auto": False, "note": "主观题：AI 阅卷为 P2 能力，暂未判分"}
            db.add(ans)
        attempt.score = total
        attempt.status = "submitted"
        attempt.finished_at = datetime.utcnow()
        db.commit()
        # 主观题：异步创建 AI 阅卷任务（P2）
        has_subjective = any(
            a.is_correct is None for a in db.scalars(
                select(Answer).where(Answer.attempt_id == attempt_id)))
        grading_task_id = None
        if has_subjective:
            gjob = jobs.create("AI 阅卷", {"attempt_id": attempt_id},
                                 lambda j: ai.run_grading(j, attempt_id))
            grading_task_id = gjob.id
        paper = db.get(Paper, attempt.paper_id)
        result = {"attempt_id": attempt.id, "score": total,
                  "total_score": paper.total_score if paper else None,
                  "status": attempt.status}
        if grading_task_id:
            result["grading_task_id"] = grading_task_id
        return result


@router.get("/attempts/{attempt_id}/report")
def attempt_report(attempt_id: str):
    with SessionLocal() as db:
        attempt = db.get(Attempt, attempt_id)
        if attempt is None:
            raise _err("E_NOT_FOUND", f"作答记录不存在: {attempt_id}", 404)
        answers = list(db.scalars(select(Answer).where(Answer.attempt_id == attempt_id)))
        items = []
        for a in answers:
            ex = db.get(Exercise, a.question_id)
            items.append({
                "answer_id": a.id,
                "question_id": ex.id, "type": ex.type, "stem": ex.stem,
                "options": ex.options, "answer": ex.answer, "explanation": ex.explanation,
                "user_answer": a.content, "is_correct": a.is_correct,
                "ai_score": a.ai_score, "ai_feedback": a.ai_feedback,
            })
        return {"attempt_id": attempt.id, "score": attempt.score,
                "status": attempt.status, "items": items}


# ============ 阅卷（P2） ============
@router.patch("/answers/{answer_id}/regrade")
async def regrade_answer(answer_id: str):
    """手动重评单题（主观题）。"""
    with SessionLocal() as db:
        ans = db.get(Answer, answer_id)
        if ans is None:
            raise _err("E_NOT_FOUND", f"作答不存在: {answer_id}", 404)
        ex = db.get(Exercise, ans.question_id)
        if ex is None:
            raise _err("E_STATE", "题目不存在", 409)
        attempt = db.get(Attempt, ans.attempt_id)
        pq = db.get(PaperQuestion, (attempt.paper_id, ans.question_id)) \
            if attempt else None
        max_score = pq.score if pq else 10
        model = await ai.resolve_model(db, None, "阅卷")
        question = {"stem": ex.stem, "answer": ex.answer,
                    "explanation": ex.explanation}
        result, _usage = await ai.grade_answer(model, question, ans.content,
                                         max_score)
        ans.ai_score = result["score"]
        ans.ai_feedback = result
        ans.is_correct = result["score"] >= max_score * 0.6
        ans.regraded_at = datetime.utcnow()
        # 重算总分
        answers = list(db.scalars(
            select(Answer).where(Answer.attempt_id == ans.attempt_id)))
        attempt.score = sum(a.ai_score or 0 for a in answers)
        db.commit()
        return {"answer_id": ans.id, **result}


# ============ 教案生成（P2） ============
@router.post("/lesson-plans/generate", response_model=TaskOut, status_code=202)
def generate_lesson_plan(body: SummaryGenerate):
    with SessionLocal() as db:
        ch = db.get(Chapter, body.chapter_id)
        if ch is None:
            raise _err("E_NOT_FOUND", f"章节不存在: {body.chapter_id}", 404)
        job = jobs.create("教案生成", {"chapter_id": body.chapter_id},
                          lambda j: ai.generate_lesson_plan(
                              j, body.chapter_id, body.model_id),
                          model_id=body.model_id or "")
        return _job_to_task(job)


@router.get("/chapters/{chapter_id}/lesson-plans")
def list_lesson_plans(chapter_id: str):
    with SessionLocal() as db:
        rows = list(db.scalars(
            select(LessonPlan).where(LessonPlan.chapter_id == chapter_id)
            .order_by(LessonPlan.version.desc())))
        return [{"id": r.id, "chapter_id": r.chapter_id, "content": r.content,
                 "version": r.version, "model_id": r.model_id,
                 "created_at": r.created_at.isoformat()} for r in rows]


# ============ 试卷导出（P2） ============
@router.get("/papers/{paper_id}/export")
def export_paper(paper_id: str, format: str = "md",
                 include_answers: bool = False):
    """导出试卷：md（Markdown）/ pdf（需安装 Typst）。"""
    import shutil as _shutil
    import subprocess

    with SessionLocal() as db:
        paper = db.get(Paper, paper_id)
        if paper is None:
            raise _err("E_NOT_FOUND", f"试卷不存在: {paper_id}", 404)
        rows = list(db.scalars(select(PaperQuestion)
                                 .where(PaperQuestion.paper_id == paper_id)
                                 .order_by(PaperQuestion.order)))
        lines = [f"# {paper.title}", "",
                 f"满分 {paper.total_score} 分 · 建议用时 {paper.duration_min} 分钟", ""]
        for i, pq in enumerate(rows, 1):
            ex = db.get(Exercise, pq.exercise_id)
            if ex is None:
                continue
            type_label = {"single": "单选题", "multi": "多选题",
                          "judge": "判断题", "fill": "填空题",
                          "short": "简答题", "calc": "计算题",
                          "essay": "论述题"}.get(ex.type, ex.type)
            lines.append(f"## 第 {i} 题（{type_label} · {pq.score} 分）")
            lines.append("")
            lines.append(ex.stem)
            lines.append("")
            if isinstance(ex.options, list) and ex.options:
                for opt in ex.options:
                    lines.append(f"- {opt}")
                lines.append("")
            if include_answers:
                lines.append(f"**参考答案：** {ex.answer}")
                if ex.explanation:
                    lines.append(f"**解析：** {ex.explanation}")
                lines.append("")
            else:
                lines.append("作答：______________")
                lines.append("")
        content = "\n".join(lines)

        if format == "md":
            dest = FILES_DIR / f"paper-{paper_id}.md"
            dest.write_text(content, encoding="utf-8")
            return {"format": "md", "path": str(dest), "content": content}

        if format == "pdf":
            if not _shutil.which("typst"):
                raise _err(
                    "E_UNSUPPORTED",
                    "未安装 Typst： brew install typst 后重试（或先用 md 格式导出）")
            typ_file = FILES_DIR / f"paper-{paper_id}.typ"
            typ_file.write_text(
                f"#set page(width: 21cm, height: 29.7cm, margin: 2cm)\n"
                f"{content.replace('#', '=')}", encoding="utf-8")
            pdf_path = FILES_DIR / f"paper-{paper_id}.pdf"
            subprocess.run(["typst", "compile", str(typ_file),
                            str(pdf_path)], check=True, timeout=120)
            return {"format": "pdf", "path": str(pdf_path)}

        raise _err("E_UNSUPPORTED", f"不支持格式 .{format}（支持 md/pdf）")


# ============ 错题本（P2 雏形） ============
@router.get("/courses/{course_id}/wrong-questions")
def wrong_questions(course_id: str, limit: int = 100):
    """错题本：聚合该课程全部作答记录中判错的题目。"""
    with SessionLocal() as db:
        paper_ids = [r[0] for r in db.execute(
            select(Paper.id).where(Paper.course_id == course_id)).all()]
        if not paper_ids:
            return {"items": []}
        attempt_ids = [r[0] for r in db.execute(
            select(Attempt.id).where(Attempt.paper_id.in_(paper_ids))).all()]
        if not attempt_ids:
            return {"items": []}
        rows = db.execute(
            select(Answer.question_id, func.count().label("errs"))
            .where(Answer.attempt_id.in_(attempt_ids),
                   Answer.is_correct == False)
            .group_by(Answer.question_id)
            .order_by(func.count().desc())
            .limit(limit)).all()
        items = []
        for qid, errs in rows:
            ex = db.get(Exercise, qid)
            if ex is None:
                continue
            items.append({
                "question_id": qid, "type": ex.type, "stem": ex.stem,
                "options": ex.options, "answer": ex.answer,
                "explanation": ex.explanation, "wrong_count": errs,
            })
        return {"items": items}


@router.post("/sessions", response_model=SessionOut, status_code=201)
def create_session(body: SessionCreate):
    with SessionLocal() as db:
        row = Session(id=_uid(), **body.model_dump())
        db.add(row)
        db.commit()
        db.refresh(row)
        return row


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(course_id: str | None = None):
    with SessionLocal() as db:
        q = select(Session)
        if course_id:
            q = q.where(Session.course_id == course_id)
        return list(db.scalars(q.order_by(Session.created_at.desc()).limit(100)))


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(session_id: str, body: dict):
    with SessionLocal() as db:
        row = db.get(Session, session_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"会话不存在: {session_id}", 404)
        for k in ("title", "scope", "mode"):
            if k in body:
                setattr(row, k, body[k])
        db.commit()
        db.refresh(row)
        return row


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
def list_messages(session_id: str):
    with SessionLocal() as db:
        return list(db.scalars(select(Message).where(Message.session_id == session_id)
                               .order_by(Message.created_at)))


@router.post("/sessions/{session_id}/messages")
async def chat_message(session_id: str, body: ChatIn, request: Request):
    """流式答疑：SSE。事件：delta / citation / done / error。"""
    async def event_stream():
        try:
            async for event, data in ai.answer_stream(session_id, body.content):
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.patch("/messages/{message_id}/pin", status_code=200)
def pin_message(message_id: str):
    return {"ok": True}  # P3：答疑卡片收藏


# ============ 模型管理 ============
@router.get("/models", response_model=list[ModelOut])
def list_models():
    with SessionLocal() as db:
        return [_model_out(m) for m in db.scalars(select(Model))]


def _model_out(m: Model) -> ModelOut:
    o = ModelOut.model_validate(m)
    o.has_key = bool(m.api_key_enc)
    return o


@router.post("/models", response_model=ModelOut, status_code=201)
def create_model(body: ModelCreate):
    with SessionLocal() as db:
        row = Model(id=_uid(), name=body.name, provider=body.provider,
                    base_url=body.base_url, api_key_enc=encrypt(body.api_key),
                    capabilities=body.capabilities,
                    context_length=body.context_length, max_output=body.max_output,
                    default_for={})
        db.add(row)
        db.commit()
        db.refresh(row)
        return _model_out(row)


@router.patch("/models/{model_id}", response_model=ModelOut)
def update_model(model_id: str, body: ModelUpdate):
    with SessionLocal() as db:
        row = db.get(Model, model_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"模型不存在: {model_id}", 404)
        data = body.model_dump(exclude_unset=True)
        if "api_key" in data and data["api_key"]:
            row.api_key_enc = encrypt(data.pop("api_key"))
        for k, v in data.items():
            setattr(row, k, v)
        db.commit()
        db.refresh(row)
        return _model_out(row)


@router.delete("/models/{model_id}", status_code=204)
def delete_model(model_id: str):
    with SessionLocal() as db:
        row = db.get(Model, model_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"模型不存在: {model_id}", 404)
        db.delete(row)
        db.commit()


@router.post("/models/{model_id}/test", response_model=ModelTestResult)
async def test_model(model_id: str):
    with SessionLocal() as db:
        row = db.get(Model, model_id)
        if row is None:
            raise _err("E_NOT_FOUND", f"模型不存在: {model_id}", 404)
        ok, detail, ms = await test_connectivity(row)
        row.status = "ok" if ok else "error"
        row.last_tested_at = datetime.utcnow()
        db.commit()
        return ModelTestResult(ok=ok, detail=detail, latency_ms=ms)


# ============ 任务中心 ============
@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(limit: int = 50):
    """合并内存中任务（本次运行）与持久化历史任务。"""
    recent = jobs.list_recent(limit)
    seen = {j.id for j in recent}
    out = [_job_to_task(j) for j in recent]
    with SessionLocal() as db:
        rows = db.scalars(
            select(AITask).where(~AITask.id.in_(seen))
            .order_by(AITask.created_at.desc()).limit(limit))
        for row in rows:
            out.append(TaskOut(id=row.id, task_type=row.task_type, status=row.status,
                               progress=row.progress, error=row.error, params=row.params,
                               result_ref=row.result_ref, model_id=row.model_id,
                               tokens_in=row.tokens_in, tokens_out=row.tokens_out,
                               cost_est=row.cost_est, started_at=row.started_at,
                               finished_at=row.finished_at, created_at=row.created_at,
                               logs=[]))
    out.sort(key=lambda t: t.created_at, reverse=True)
    return out[:limit]


@router.get("/tasks/{task_id}", response_model=TaskOut)
def get_task(task_id: str):
    job = jobs.jobs.get(task_id)
    if job is None:
        # 从持久化记录恢复（历史任务）
        with SessionLocal() as db:
            from app.models import AITask
            row = db.get(AITask, task_id)
            if row is None:
                raise _err("E_NOT_FOUND", f"任务不存在: {task_id}", 404)
            return TaskOut(id=row.id, task_type=row.task_type, status=row.status,
                           progress=row.progress, error=row.error, params=row.params,
                           result_ref=row.result_ref, model_id=row.model_id,
                           tokens_in=row.tokens_in, tokens_out=row.tokens_out,
                           cost_est=row.cost_est, started_at=row.started_at,
                           finished_at=row.finished_at, created_at=row.created_at, logs=[])
    return _job_to_task(job)


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str):
    if jobs.cancel(task_id):
        return {"ok": True}
    raise _err("E_STATE", "任务不存在或未在运行", 409)


@router.get("/tasks/{task_id}/events")
async def task_events(task_id: str):
    q: asyncio.Queue = jobs.subscribe(task_id)

    async def stream():
        try:
            # 先推送当前状态
            job = jobs.jobs.get(task_id)
            if job:
                yield f"event: task.progress\ndata: {json.dumps(job.to_dict(), ensure_ascii=False)}\n\n"
            while True:
                payload = await q.get()
                yield f"event: {payload['event']}\ndata: {json.dumps(payload['data'], ensure_ascii=False)}\n\n"
                if payload["event"] in ("task.done", "task.error"):
                    break
        finally:
            jobs.unsubscribe(task_id, q)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ============ 提示词模板 ============
@router.get("/prompt-templates")
def list_prompt_templates():
    from app.models import PromptTemplate
    with SessionLocal() as db:
        rows = list(db.scalars(select(PromptTemplate).order_by(PromptTemplate.task_type)))
        return [{"id": r.id, "task_type": r.task_type, "name": r.name,
                 "content": r.content, "version": r.version} for r in rows]


@router.put("/prompt-templates/{task_type}")
def upsert_prompt_template(task_type: str, content: str, name: str = ""):
    from app.models import PromptTemplate
    with SessionLocal() as db:
        latest = db.scalars(
            select(PromptTemplate).where(PromptTemplate.task_type == task_type)
            .order_by(PromptTemplate.version.desc()).limit(1)).first()
        version = (latest.version + 1) if latest else 1
        row = PromptTemplate(id=_uid(), task_type=task_type,
                             name=name or task_type, content=content, version=version)
        db.add(row)
        db.commit()
        return {"id": row.id, "version": version}


# ============ 设置 ============
@router.get("/settings")
def get_settings():
    with SessionLocal() as db:
        return {"settings": {r.key: r.value for r in db.scalars(select(Setting))}}


@router.put("/settings")
def put_settings(body: dict):
    with SessionLocal() as db:
        for k, v in body.items():
            row = db.get(Setting, k)
            if row is None:
                db.add(Setting(key=k, value=json.dumps(v, ensure_ascii=False)))
            else:
                row.value = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
        db.commit()
        return {"ok": True}


# ============ 工具 ============
def _job_to_task(job) -> TaskOut:
    d = job.to_dict()
    return TaskOut(**d)
