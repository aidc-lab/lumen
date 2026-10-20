"""索引与检索：FTS5（trigram 分词，兼容中文）+ sqlite-vec（余弦）混合检索，RRF 融合。

向量由用户在模型管理中配置的嵌入模型生成（OpenAI 兼容 /embeddings 接口）；
未配置嵌入模型时降级为纯全文检索。
"""
import logging

from sqlalchemy import delete, select, text

from app.core.db import DEFAULT_EMBEDDING_DIM, SessionLocal, VEC_AVAILABLE
from app.models import Chapter, ChapterChunk, Textbook
from app.services.llm import LLMError, embeddings as llm_embeddings

try:
    import sqlite_vec
    _serialize = sqlite_vec.serialize_float32
except Exception:
    _serialize = None

logger = logging.getLogger("app.indexing")

RRF_K = 60
EMBED_BATCH = 64
VEC_K = 20


async def rebuild_chapter_index(chapter_id: str, job=None) -> int:
    """重建某章节的 FTS + 向量索引，返回块数。"""
    with SessionLocal() as db:
        chapter = db.get(Chapter, chapter_id)
        if chapter is None:
            raise ValueError(f"章节不存在: {chapter_id}")
        # 清除旧索引（用会话自身的连接，避免 StaticPool 单连接死锁）
        db.execute(text("DELETE FROM chapter_fts WHERE chapter_id = :c"), {"c": chapter_id})
        if VEC_AVAILABLE:
            db.execute(text(
                "DELETE FROM vec_chunks WHERE chunk_id IN "
                "(SELECT id FROM chapter_chunks WHERE chapter_id = :c)"), {"c": chapter_id})
        db.execute(delete(ChapterChunk).where(ChapterChunk.chapter_id == chapter_id))

        # 重建块（按页归属优先；无页码信息时按段落）
        from app.services.parsing import split_chunks
        chunks = split_chunks(chapter.content, None, chapter.title)
        for c in chunks:
            db.add(ChapterChunk(
                chapter_id=chapter_id,
                para_no=c["para_no"],
                page_no=c["page_no"],
                heading_path=c["heading_path"],
                content=c["content"],
                token_count=c["token_count"],
            ))
        db.commit()
        chunk_rows = db.execute(
            text("SELECT id, content FROM chapter_chunks WHERE chapter_id = :c ORDER BY id"),
            {"c": chapter_id},
        ).all()

        # FTS 全文索引（CJK 逐字分词后入库，支持中文子串检索）
        # 注意：空章节（封面/扉页等无正文标题页）无 chunk，需跳过空 executemany
        if chunk_rows:
            db.execute(
                text("INSERT INTO chapter_fts (chunk_id, chapter_id, content) VALUES (:i, :c, :t)"),
                [{"i": r[0], "c": chapter_id, "t": _cjk_spaced(r[1])} for r in chunk_rows])
            # 先提交 FTS：后续向量化失败时 rollback 不能把全文索引一起回滚
            db.commit()
        else:
            logger.info("章节 %s 无正文，跳过索引", chapter_id)

        # 向量化（需要用户配置的嵌入模型）
        dim, model_id = _embedding_config(db)
        if VEC_AVAILABLE and model_id and chunk_rows:
            from app.models import Model
            model = db.get(Model, model_id)
            if model is None:
                logger.warning("默认嵌入模型不存在，跳过向量化")
            else:
                try:
                    total = 0
                    for i in range(0, len(chunk_rows), EMBED_BATCH):
                        batch = chunk_rows[i:i + EMBED_BATCH]
                        vecs = await llm_embeddings(model, [r[1] for r in batch])
                        if vecs and len(vecs[0]) != dim:
                            raise LLMError(
                                f"嵌入维度 {len(vecs[0])} 与配置 {dim} 不符，"
                                "请在设置中调整 embedding_dim")
                        db.execute(
                            text("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (:i, :e)"),
                            [{"i": r[0], "e": _serialize(vec)}
                             for r, vec in zip(batch, vecs)])
                        total += len(batch)
                        if job:
                            job.set_progress(min(90.0, total / len(chunk_rows) * 90),
                                             f"向量化 {total}/{len(chunk_rows)} 段")
                    db.commit()
                    logger.info("章节 %s 向量化完成（%d 段）", chapter_id, total)
                except Exception as e:
                    db.rollback()
                    logger.warning("向量化失败（不影响全文检索）: %s", e)
                    if job:
                        job.log(f"⚠ 向量化跳过：{e}", "warn")
        else:
            if job:
                job.log("未配置嵌入模型或 sqlite-vec：仅建立全文索引", "warn")
        db.commit()

        chapter.word_count = len(chapter.content)
        db.commit()
        return len(chunk_rows)


def _embedding_config(db) -> tuple[int, str | None]:
    from app.models import Model, Setting, parse_setting
    row = db.get(Setting, "embedding_dim")
    raw = (parse_setting(row.value) if row else "").strip().strip('"')
    dim = int(raw) if raw.isdigit() else DEFAULT_EMBEDDING_DIM
    # 设置页按任务保存为 default_model:向量化；兼容旧键 default_embedding_model_id
    srow = db.get(Setting, "default_model:向量化")
    if srow is None:
        srow = db.get(Setting, "default_embedding_model_id")
    model_id = (parse_setting(srow.value) if srow else None) or None
    if model_id is None:
        # 与设置页展示一致：未显式保存时回退到首个具备 embedding 能力的模型
        for m in db.scalars(select(Model)):
            if "embedding" in (m.capabilities or []):
                model_id = m.id
                break
    return dim, model_id


async def hybrid_search(query: str, chapter_ids: list[str] | None = None, k: int = 8,
                        course_id: str | None = None) -> list[dict]:
    """混合检索：FTS5 trigram ∪ 向量余弦，RRF 融合。

    chapter_ids：显式章节范围（优先）；
    course_id：未指定章节时按课程收敛，避免跨课程检索/串库。
    """
    params: dict = {}
    scope_clause = _scope_clause(chapter_ids, course_id, params)

    results: dict[int, dict] = {}

    # 1) FTS5（trigram 分词：支持中文子串匹配）
    with SessionLocal() as db:
        fts_sql = ("SELECT chunk_id, chapter_id, content, bm25(chapter_fts) AS rank "
                   "FROM chapter_fts WHERE chapter_fts MATCH :q " + scope_clause +
                   " ORDER BY rank LIMIT 20")
        params["q"] = _fts_query(query)
        try:
            rows = db.execute(text(fts_sql), params).all()
        except Exception as e:
            logger.warning("FTS 检索失败: %s", e)
            rows = []
        for i, (chunk_id, chapter_id, content, _rank) in enumerate(rows):
            results[chunk_id] = {
                "chunk_id": chunk_id, "chapter_id": chapter_id, "content": content,
                "score": 1.0 / (RRF_K + i + 1),
            }

        # 2) 向量检索
        if VEC_AVAILABLE:
            vec = await _query_embedding(query)
            if vec:
                try:
                    vrows = _vec_search(db, vec, chapter_ids, params, course_id)
                    for i, (chunk_id, _dist) in enumerate(vrows):
                        s = 1.0 / (RRF_K + i + 1)
                        if chunk_id in results:
                            results[chunk_id]["score"] += s
                        else:
                            results[chunk_id] = {"chunk_id": chunk_id, "chapter_id": None,
                                                 "content": "", "score": s}
                except Exception as e:
                    logger.warning("向量检索失败: %s", e)

        # 3) 关联章节/教材名、页码，过滤空内容
        out = []
        for item in sorted(results.values(), key=lambda x: -x["score"])[:k]:
            chunk = db.get(ChapterChunk, item["chunk_id"])
            if chunk is None:
                continue
            chapter = db.get(Chapter, chunk.chapter_id)
            textbook = db.get(Textbook, chapter.textbook_id) if chapter else None
            if chapter is None or textbook is None:
                continue  # 章节/教材已删除，避免返回不可定位的孤儿结果
            out.append({
                "chunk_id": chunk.id,
                "chapter_id": chunk.chapter_id,
                "chapter_title": chapter.title,
                "textbook_id": textbook.id,
                "textbook_title": textbook.title,
                "course_id": textbook.course_id,
                "page_no": chunk.page_no,
                "para_no": chunk.para_no,
                "snippet": chunk.content[:200],
                "score": item["score"],
            })
    return out


def _scope_clause(chapter_ids: list[str] | None, course_id: str | None,
                  params: dict) -> str:
    """构造检索范围 SQL（FTS 表的 chapter_id 为 UNINDEXED 列，可直接过滤）。"""
    if chapter_ids:
        ids = ",".join(f":c{i}" for i in range(len(chapter_ids)))
        params.update({f"c{i}": cid for i, cid in enumerate(chapter_ids)})
        return f"AND chapter_id IN ({ids})"
    if course_id:
        params["scope_course_id"] = course_id
        return ("AND chapter_id IN (SELECT c.id FROM chapters c "
                "JOIN textbooks t ON c.textbook_id = t.id "
                "WHERE t.course_id = :scope_course_id)")
    return ""


def _vec_search(db, vec, chapter_ids, params, course_id: str | None = None) -> list:
    """执行 sqlite-vec 余弦检索。向量以 blob 绑定。"""
    dim, _model_id = _embedding_config(db)
    if len(vec) != dim:
        raise ValueError("查询向量维度与索引不符")
    if _serialize is None:
        raise RuntimeError("sqlite-vec 序列化不可用")
    sql = ("SELECT v.chunk_id, v.distance FROM vec_chunks v "
           "WHERE v.embedding MATCH :e AND v.k = :k ")
    if chapter_ids:
        ids = ",".join(f":c{i}" for i in range(len(chapter_ids)))
        sql += f"AND v.chunk_id IN (SELECT id FROM chapter_chunks WHERE chapter_id IN ({ids})) "
    elif course_id:
        sql += ("AND v.chunk_id IN (SELECT cc.id FROM chapter_chunks cc "
                "JOIN chapters c ON cc.chapter_id = c.id "
                "JOIN textbooks t ON c.textbook_id = t.id "
                "WHERE t.course_id = :scope_course_id) ")
    sql += "ORDER BY v.distance LIMIT :k"
    return db.execute(text(sql),
                      {**params, "e": _serialize(vec), "k": VEC_K}).all()


async def _query_embedding(query: str) -> list | None:
    """用默认嵌入模型生成查询向量；失败返回 None。"""
    with SessionLocal() as db:
        _dim, model_id = _embedding_config(db)
        if not model_id:
            return None
        from app.models import Model
        model = db.get(Model, model_id)
        if model is None:
            return None
        try:
            from app.services.llm import embeddings as llm_embeddings
            vecs = await llm_embeddings(model, [query])
            return vecs[0] if vecs else None
        except Exception as e:
            logger.warning("查询向量化失败: %s", e)
            return None


def _fts_query(query: str) -> str:
    """FTS5 查询串：拉丁字母/数字收集为整词短语匹配；CJK 字逐字拆开做 AND 匹配
    （不要求连续，保证自然语言问句的召回率）；标点与空白丢弃。"""
    tokens = [t.strip() for t in query.replace('"', "").split() if t.strip()]
    if not tokens:
        return '"*"'
    parts = []
    for t in tokens:
        latin_buf = ""
        for ch in t:
            if _is_cjk(ch):
                if latin_buf:
                    parts.append(f'"{latin_buf}"')
                    latin_buf = ""
                parts.append(f'"{ch}"')
            elif ch.isalnum():
                latin_buf += ch
            else:
                if latin_buf:
                    parts.append(f'"{latin_buf}"')
                    latin_buf = ""
        if latin_buf:
            parts.append(f'"{latin_buf}"')
    if not parts:
        return '"*"'
    # OR 语义：任一字/词命中即召回（自然语言问句常含原文没有的虚词），
    # 由 BM25 按相关度排序；RAG 场景召回优先
    return " OR ".join(parts)


def _cjk_spaced(text: str) -> str:
    """在 CJK 字符间插入空格（逐字分词），拉丁字符/数字保持连续。"""
    out = []
    for ch in text:
        out.append(ch)
        if _is_cjk(ch):
            out.append(" ")
    return "".join(out)


def _is_cjk(ch: str) -> bool:
    o = ord(ch)
    return (
        0x4E00 <= o <= 0x9FFF   # CJK 统一表意文字
        or 0x3400 <= o <= 0x4DBF  # 扩展 A
        or 0xF900 <= o <= 0xFAFF  # 兼容表意文字
        or 0x3000 <= o <= 0x303F  # CJK 标点
    )


def clear_textbook_index(textbook_id: str):
    with SessionLocal() as db:
        ch_ids = [r[0] for r in db.execute(
            text("SELECT id FROM chapters WHERE textbook_id = :t"),
            {"t": textbook_id}).all()]
        if not ch_ids:
            return
        # 参数化 IN（直接拼值会被当单个字面量，匹配不到任何行）
        ph = ",".join(f":i{n}" for n in range(len(ch_ids)))
        bind = {f"i{n}": c for n, c in enumerate(ch_ids)}
        db.execute(text(f"DELETE FROM chapter_fts WHERE chapter_id IN ({ph})"), bind)
        db.execute(delete(ChapterChunk).where(ChapterChunk.chapter_id.in_(ch_ids)))
        if VEC_AVAILABLE:
            db.execute(text(
                f"DELETE FROM vec_chunks WHERE chunk_id IN "
                f"(SELECT id FROM chapter_chunks WHERE chapter_id IN ({ph}))"), bind)
        db.commit()


def vec_stats() -> dict:
    with SessionLocal() as db:
        n_chunks = db.execute(text("SELECT COUNT(*) FROM chapter_chunks")).scalar() or 0
        n_vec = 0
        if VEC_AVAILABLE:
            try:
                n_vec = db.execute(text("SELECT COUNT(*) FROM vec_chunks")).scalar() or 0
            except Exception:
                n_vec = 0
        return {"chunks": n_chunks, "vectors": n_vec, "vec_available": VEC_AVAILABLE}
