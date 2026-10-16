"""AI 生成能力：章节总结、习题生成、答疑（RAG + 引用溯源）。

所有产出均可溯源到 [教材名｜章节｜页码｜段落号]。
"""
import asyncio
import json
import logging
import re
import uuid
from datetime import datetime

from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.models import (Answer, Attempt, Chapter, Exercise, LessonPlan,
                        Message, Model, PaperQuestion, PromptTemplate,
                        Session, Summary, Textbook, parse_setting)
from app.services import llm
from app.services.indexing import hybrid_search
from app.services.llm import LLMError, extract_json

logger = logging.getLogger("app.ai")

CITE_RE = re.compile(r"【cite:(\d+)】")


async def get_default_model(db, task_type: str, capability: str = "text") -> Model | None:
    """按任务类型取默认模型；未配置则取第一个具备能力的模型。"""
    models = list(db.scalars(select(Model)))
    for m in models:
        defaults = m.default_for or {}
        if defaults.get(task_type) and capability in (m.capabilities or []):
            return m
    for m in models:
        if capability in (m.capabilities or []):
            return m
    return None


async def resolve_model(db, model_id: str | None, task_type: str, capability: str = "text") -> Model:
    """模型解析优先级：显式指定 > 设置页任务级默认 > 首个具备能力的模型。"""
    if model_id:
        m = db.get(Model, model_id)
        if m is None:
            raise ValueError(f"模型不存在: {model_id}")
        return m
    # 任务级默认模型（设置页「模型默认策略」）
    from app.models import Setting
    srow = db.get(Setting, f"default_model:{task_type}")
    if srow:
        m = db.get(Model, parse_setting(srow.value))
        if m is not None and capability in (m.capabilities or []):
            return m
    m = await get_default_model(db, task_type, capability)
    if m is None:
        raise ValueError("未配置可用模型：请先在「模型管理」中添加（云端 API 或自建 Ollama/LM Studio）")
    return m


def _budget_chars(model: Model) -> int:
    """上下文预算：约留一半给输出与系统提示。"""
    return max(2000, (model.context_length or 8192) // 2)


def _truncate(text: str, budget: int) -> str:
    if len(text) <= budget:
        return text
    return text[:budget] + f"\n\n[原文过长，此处截断，共 {len(text)} 字]"


async def get_prompt(db, task_type: str) -> str:
    row = db.scalars(
        select(PromptTemplate).where(PromptTemplate.task_type == task_type)
        .order_by(PromptTemplate.version.desc()).limit(1)
    ).first()
    return row.content if row else DEFAULT_PROMPTS.get(task_type, "")


DEFAULT_PROMPTS = {
    "summary": (
        "你是教材辅导专家。请阅读下面的教材章节内容，生成结构化知识总结（Markdown）：\n"
        "## 知识框架\n（大纲）\n## 核心概念\n（定义）\n## 公式与定理\n（清单）\n"
        "## 易错点\n（列表）\n\n要求：忠于原文，概念定义必须与教材一致；不要编造教材中没有的内容。"
    ),
    "exercise": (
        "你是命题专家。请根据下面的教材内容出题。\n"
        "输出 JSON 数组，每题格式：{\"type\": \"single|multi|judge|fill|short|calc|essay\", "
        "\"stem\": \"题干\", \"options\": [\"A. …\", \"B. …\"]（客观题必填）, "
        "\"answer\": \"参考答案\", \"explanation\": \"解析\", \"difficulty\": 1-5, "
        "\"source_refs\": [{\"chapter\": \"章节名\", \"page\": 页码, \"para\": 段号}]}。\n"
        "要求：答案唯一且正确；选项互斥；题干表述清晰；来源必须基于所给内容。"
    ),
    "qa": (
        "你是 AI 教师，严格基于【教材片段】回答学生问题。\n"
        "规则：\n1. 只依据教材片段作答，不要编造；片段未覆盖的内容，明确声明"
        "「教材未覆盖」并说明已知信息。\n2. 引用处使用【cite:N】标注，N 为片段编号（从 1 开始）。\n"
        "3. 回答简洁、条理清晰，适合学生自学。\n"
        "4. 若模式为苏格拉底式，先给提示与思路，不直接给完整答案。"
    ),
    "grade": (
        "你是阅卷专家。按参考答案与评分细则给学生作答评分。\n"
        "输出 JSON：{\"score\": 分数, \"max_score\": 满分, "
        "\"points\": [{\"desc\": \"得分点\", \"obtained\": 得分}], "
        "\"deductions\": [{\"reason\": \"扣分原因\", \"points\": 扣分}], "
        "\"suggestions\": [\"改进建议\"]}。\n要求：严格按得分点给分，理由具体。"
    ),
    "lesson": (
        "你是教学专家。请为下面的教材章节设计一份教案（Markdown）：\n"
        "## 教学目标（可测量）\n## 重点与难点\n"
        "## 教学过程（引入 / 讲解 / 练习 / 小结）\n## 课堂提问\n## 作业布置\n"
        "要求：提问与练习紧扣教材内容，可用教材原文作答。"
    ),
}


# ---------------- 章节总结 ----------------
async def generate_summary(job, chapter_id: str, model_id: str | None = None) -> str:
    with SessionLocal() as db:
        chapter = db.get(Chapter, chapter_id)
        if chapter is None:
            raise ValueError(f"章节不存在: {chapter_id}")
        textbook = db.get(Textbook, chapter.textbook_id)
        model = await resolve_model(db, model_id, "总结")
        job.model_id = model.id
        prompt = await get_prompt(db, "summary")
        content = _truncate(chapter.content, _budget_chars(model))
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"教材：《{textbook.title}》\n章节：{chapter.title}\n\n{content}"},
        ]
        job.set_progress(30, "正在生成章节总结…")
        content_out, usage = await llm.chat(model, messages, temperature=0.3)
        job.tokens_in = usage.get("prompt_tokens", 0)
        job.tokens_out = usage.get("completion_tokens", 0)
        job.set_progress(80, "正在保存…")
        # 单版本：重新生成直接替换旧总结
        db.execute(delete(Summary).where(Summary.chapter_id == chapter_id))
        row = Summary(id=uuid.uuid4().hex, chapter_id=chapter_id, content=content_out,
                      model_id=model.id, version=1,
                      params={"model": model.name})
        db.add(row)
        db.commit()
        job.result_ref = row.id
        return row.id


# ---------------- 习题生成 ----------------
async def generate_exercises(job, params: dict) -> list[str]:
    """按范围生成习题（草稿）。返回生成的题目 id 列表。"""
    course_id = params["course_id"]
    chapter_ids = params.get("chapter_ids") or []
    textbook_id = params.get("textbook_id")
    types = params.get("types") or {"single": 3, "judge": 2, "short": 2}
    difficulty = params.get("difficulty", 3)
    explain = params.get("explain", True)
    model_id = params.get("model_id")

    with SessionLocal() as db:
        model = await resolve_model(db, model_id, "出题")
        job.model_id = model.id
        prompt = await get_prompt(db, "exercise")
        chapters = _collect_chapters(db, course_id, chapter_ids, textbook_id)
        if not chapters:
            raise ValueError("范围内没有章节")
        total = len(chapters)
        created: list[str] = []
        for i, chapter in enumerate(chapters):
            job.check_cancelled()
            textbook = db.get(Textbook, chapter.textbook_id)
            content = _truncate(chapter.content, _budget_chars(model))
            type_desc = "、".join(f"{t}×{n}" for t, n in types.items() if n > 0)
            messages = [
                {"role": "system", "content": prompt},
                {"role": "user", "content": (
                    f"教材：《{textbook.title}》\n章节：{chapter.title}（{chapter.page_start or '?'}）\n"
                    f"要求：{type_desc}，难度 {difficulty}\n\n{content}")},
            ]
            job.set_progress((i / total) * 80, f"正在生成「{chapter.title}」…")
            try:
                out, usage = await llm.chat(model, messages, temperature=0.7, response_json=True)
                job.tokens_in += usage.get("prompt_tokens", 0)
                job.tokens_out += usage.get("completion_tokens", 0)
            except LLMError:
                # 部分本地模型不支持 response_format，降级为提示词约束 + 文本提取
                out, usage = await llm.chat(model, messages, temperature=0.7)
                job.tokens_in += usage.get("prompt_tokens", 0)
                job.tokens_out += usage.get("completion_tokens", 0)
            questions = _parse_questions(out)
            validated = _validate_questions(questions, types)
            for q in validated:
                row = Exercise(
                    id=uuid.uuid4().hex,
                    course_id=course_id, chapter_id=chapter.id,
                    type=q["type"], difficulty=q.get("difficulty") or difficulty,
                    stem=q["stem"], options=q.get("options"),
                    answer=q.get("answer", "") if explain or True else "",
                    explanation=q.get("explanation", "") if explain else "",
                    source_refs=q.get("source_refs") or [{"chapter": chapter.title,
                                                          "page": chapter.page_start, "para": None}],
                    model_id=model.id, status="draft",
                )
                db.add(row)
                db.commit()
                created.append(row.id)
        job.set_progress(95, f"已生成 {len(created)} 题（草稿箱待审校）")
        return created


def _collect_chapters(db, course_id, chapter_ids, textbook_id):
    from app.models import Textbook as T
    if chapter_ids:
        return [db.get(Chapter, cid) for cid in chapter_ids if db.get(Chapter, cid)]
    if textbook_id:
        return list(db.scalars(select(Chapter).where(Chapter.textbook_id == textbook_id)
                               .order_by(Chapter.path)))
    tids = [t.id for t in db.scalars(select(T).where(T.course_id == course_id))]
    if not tids:
        return []
    return list(db.scalars(select(Chapter).where(Chapter.textbook_id.in_(tids))
                           .order_by(Chapter.path)))


def _parse_questions(out: str) -> list[dict]:
    data = extract_json(out)
    if isinstance(data, dict) and "questions" in data:
        data = data["questions"]
    if not isinstance(data, list):
        raise LLMError("模型输出不是题目数组")
    return [q for q in data if isinstance(q, dict) and q.get("stem")]


def _validate_questions(questions: list[dict], types: dict) -> list[dict]:
    """校验：题型合法、客观题选项与答案完整；不合规的题目修复或丢弃。"""
    valid_types = {"single", "multi", "judge", "fill", "short", "calc", "essay"}
    out = []
    for q in questions:
        q = dict(q)
        q["type"] = q.get("type") if q.get("type") in valid_types else "short"
        if q["type"] in {"single", "multi", "judge"}:
            opts = q.get("options") or []
            if q["type"] in {"single", "multi"} and (not opts or not q.get("answer")):
                continue  # 选项或答案缺失：丢弃
            if q["type"] == "judge":
                q["options"] = ["√ 正确", "× 错误"]
                if not q.get("answer"):
                    continue
        if not q.get("answer"):
            q["answer"] = ""
        out.append(q)
    return out


# ---------------- 答疑（RAG + 引用） ----------------
async def answer_stream(session_id: str, question: str,
                        model_id: str | None = None,
                        chapter_ids: list[str] | None = None):
    """RAG 答疑：检索 → 拼接上下文 → 流式生成 → 引用抽取。

    产出 (event, data) 元组流：
      ("delta", str)       文本增量
      ("citation", dict)   引用信息
      ("done", dict)       汇总（tokens、引用列表）
    """
    with SessionLocal() as db:
        sess = db.get(Session, session_id)
        if sess is None:
            raise ValueError(f"会话不存在: {session_id}")
        # 本次显式指定的章节范围优先；否则沿用会话持久化的 scope
        ids = chapter_ids if chapter_ids is not None else ((sess.scope or {}).get("chapter_ids") or None)
        model = await resolve_model(db, model_id, "答疑")
        sess.mode = sess.mode or "direct"

        # 1) 检索
        hits = await hybrid_search(question, chapter_ids, k=5)
        if not hits:
            yield ("delta", "（未检索到相关教材内容，请先确认该章节已导入并建立索引。）")
            yield ("done", {"citations": [], "tokens_in": 0, "tokens_out": 0, "model_id": model.id})
            return

        # 2) 上下文组装（带出处标签）
        context_blocks = []
        for i, h in enumerate(hits, 1):
            ref = f"《{h['textbook_title']}》{h['chapter_title']}"
            if h.get("page_no"):
                ref += f" p.{h['page_no']}"
            ref += f" ¶{h['para_no']}"
            context_blocks.append(f"【片段 {i}｜{ref}】\n{h['snippet']}")
        context = "\n\n".join(context_blocks)

        # 保存用户消息（附带本次 @ 引用，便于历史回看）
        ref_labels: list[str] = []
        for cid in (ids or []):
            ch = db.get(Chapter, cid)
            if ch is None:
                continue
            tb = db.get(Textbook, ch.textbook_id)
            ref_labels.append(f"《{tb.title if tb else ''}》{ch.title}")
        user_msg = Message(id=uuid.uuid4().hex, session_id=session_id, role="user", content=question,
                           citations={"refs": ref_labels} if ref_labels else None)
        db.add(user_msg)
        db.commit()

        # 3) 生成（流式）
        system = await get_prompt(db, "qa")
        if sess.mode == "socratic":
            system += "\n当前模式：苏格拉底式引导——先给提示与思路，不直接给完整答案。"
        elif sess.mode == "review":
            system += "\n当前模式：批改学生思路——先指出思路中的问题，再给出正确方向。"
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"教材片段：\n{context}\n\n学生问题：{question}"},
        ]
        gen = await llm.chat(model, messages, temperature=0.3, stream=True)
        full_text = ""
        citations: list[dict] = []
        pending = ""
        MARKER_PREFIX = "【cite"

        def _emit_safe_text():
            """产出 pending 中确定不是引用标记前缀的部分；保留可能是标记前缀的尾部。"""
            nonlocal pending
            if not pending:
                return None
            # 完整标记前缀之前的文本安全
            idx = pending.rfind(MARKER_PREFIX)
            if idx >= 0:
                safe, pending = pending[:idx], pending[idx:]
                return safe or None
            # 否则检查尾部是否为标记前缀的截断（如 "【ci"）
            hold = 0
            for L in range(min(len(pending), len(MARKER_PREFIX) - 1), 0, -1):
                if pending[-L:] == MARKER_PREFIX[:L]:
                    hold = L
                    break
            safe = pending[: len(pending) - hold]
            pending = pending[hold:]
            return safe or None

        async for delta in gen:
            full_text += delta
            pending += delta
            # 检测并消费完整的引用标记
            while True:
                m = CITE_RE.search(pending)
                if not m:
                    break
                idx = int(m.group(1))
                if 1 <= idx <= len(hits):
                    h = hits[idx - 1]
                    cite_info = {
                        "textbook": h["textbook_title"],
                        "chapter": h["chapter_title"],
                        "page_no": h.get("page_no"),
                        "para_no": h["para_no"],
                        "snippet": h["snippet"][:120],
                        "chunk_id": h["chunk_id"],
                    }
                    if cite_info not in citations:
                        citations.append(cite_info)
                        yield ("citation", cite_info)
                pending = pending[m.end():]
            # 产出安全文本
            safe = _emit_safe_text()
            if safe:
                yield ("delta", safe)
        # 流结束：冲刷缓冲区（此时不再有新标记）
        if pending:
            yield ("delta", pending)
            pending = ""

        usage = getattr(llm._stream_gen, "last_usage", {}) or {}
        # 替换全文中的引用标记为可点击形式（前端展示用）
        cleaned = CITE_RE.sub("", full_text)
        ai_msg = Message(id=uuid.uuid4().hex, session_id=session_id, role="assistant", content=cleaned,
                         citations={"list": citations}, model_id=model.id,
                         tokens_in=usage.get("prompt_tokens", 0),
                         tokens_out=usage.get("completion_tokens", 0))
        db.add(ai_msg)
        db.commit()
        yield ("done", {
            "message_id": ai_msg.id,
            "citations": citations,
            "tokens_in": usage.get("prompt_tokens", 0),
            "tokens_out": usage.get("completion_tokens", 0),
            "model_id": model.id,
        })


# ---------------- 主观题 AI 阅卷 ----------------
async def grade_answer(model: Model, question: dict, user_answer: str,
                       max_score: int) -> tuple[dict, dict]:
    """主观题阅卷：结构化 JSON 评分。返回 (评分结果, token 用量)。"""
    prompt = await _grade_prompt(None)
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": (
            f"题目：{question['stem']}\n"
            f"参考答案：{question.get('answer', '')}\n"
            f"解析：{question.get('explanation', '')}\n"
            f"满分：{max_score} 分\n"
            f"学生作答：{user_answer or '（未作答）'}")},
    ]
    try:
        out, usage = await llm.chat(model, messages, temperature=0.2,
                                       response_json=True)
        result = extract_json(out)
    except LLMError:
        # 部分本地模型不支持 response_format，降级为文本提取
        out, usage = await llm.chat(model, messages, temperature=0.2)
        result = extract_json(out)
    # 校验与修正
    score = int(result.get("score", 0))
    result["score"] = max(0, min(max_score, score))
    result["max_score"] = max_score
    result.setdefault("points", [])
    result.setdefault("deductions", [])
    result.setdefault("suggestions", [])
    return result, usage


async def _grade_prompt(db) -> str:
    if db is not None:
        return await get_prompt(db, "grade")
    return DEFAULT_PROMPTS.get("grade", "")


async def run_grading(job, attempt_id: str) -> str:
    """阅卷任务：批改某次作答的全部主观题并更新总分。"""
    with SessionLocal() as db:
        attempt = db.get(Attempt, attempt_id)
        if attempt is None:
            raise ValueError(f"作答记录不存在: {attempt_id}")
        answers = list(db.scalars(
            select(Answer).where(Answer.attempt_id == attempt_id)))
        subjective = [a for a in answers if a.is_correct is None]
        if not subjective:
            return attempt_id
        model = await resolve_model(db, None, "阅卷")
        job.model_id = model.id
        total = 0
        for i, ans in enumerate(subjective):
            job.check_cancelled()
            ex = db.get(Exercise, ans.question_id)
            pq = db.get(PaperQuestion,
                        (attempt.paper_id, ans.question_id))
            max_score = pq.score if pq else 10
            job.set_progress((i / len(subjective)) * 90,
                             f"批改第 {i + 1}/{len(subjective)} 题…")
            question = {"stem": ex.stem if ex else "",
                        "answer": ex.answer if ex else "",
                        "explanation": ex.explanation if ex else ""}
            try:
                result, usage = await grade_answer(model, question, ans.content,
                                                     max_score)
                job.tokens_in += usage.get("prompt_tokens", 0)
                job.tokens_out += usage.get("completion_tokens", 0)
            except Exception as e:
                job.log(f"⚠ 第 {i + 1} 题阅卷失败：{e}", "warn")
                result = {"score": 0, "max_score": max_score,
                          "points": [], "deductions": [],
                          "suggestions": [f"阅卷失败：{e}"]}
            ans.ai_score = result["score"]
            ans.ai_feedback = result
            ans.is_correct = result["score"] >= result["max_score"] * 0.6
            ans.regraded_at = datetime.utcnow()
            total += result["score"]
        # 总分 = 客观题 + 主观题
        obj_total = sum(a.ai_score or 0 for a in answers
                        if a.is_correct is not None)
        attempt.score = obj_total + total
        attempt.status = "graded"
        db.commit()
        job.set_progress(100, f"阅卷完成：主观题 {total} 分")
        return attempt_id


# ---------------- 教案生成 ----------------
async def generate_lesson_plan(job, chapter_id: str,
                               model_id: str | None = None) -> str:
    with SessionLocal() as db:
        chapter = db.get(Chapter, chapter_id)
        if chapter is None:
            raise ValueError(f"章节不存在: {chapter_id}")
        textbook = db.get(Textbook, chapter.textbook_id)
        model = await resolve_model(db, model_id, "教案")
        job.model_id = model.id
        prompt = await get_prompt(db, "lesson")
        content = _truncate(chapter.content, _budget_chars(model))
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": (
                f"教材：《{textbook.title}》\n章节：{chapter.title}\n\n{content}")},
        ]
        job.set_progress(30, "正在生成教案…")
        content_out, usage = await llm.chat(model, messages, temperature=0.5)
        job.tokens_in = usage.get("prompt_tokens", 0)
        job.tokens_out = usage.get("completion_tokens", 0)
        # 单版本：重新生成直接替换旧教案
        db.execute(delete(LessonPlan).where(LessonPlan.chapter_id == chapter_id))
        row = LessonPlan(id=uuid.uuid4().hex, chapter_id=chapter_id,
                         content=content_out, model_id=model.id, version=1,
                         params={"model": model.name})
        db.add(row)
        db.commit()
        job.result_ref = row.id
        return row.id
