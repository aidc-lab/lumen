"""文档解析：PDF / DOCX / MD / TXT / EPUB 文本抽取、结构识别、自动切分、段落块化。

可选依赖按需导入；缺失时抛出友好错误。扫描件检测：文本提取率 < 5% 时提示 OCR（OCR 本身为可选步骤，P1）。
"""
import hashlib
import logging
import re

logger = logging.getLogger("app.parsing")

AUTO_SPLIT_CHARS = 3000   # 无结构时按字数阈值自动切分
CHUNK_MAX_CHARS = 800     # 段落块上限


class ParseError(Exception):
    pass


# ---------------- 文本抽取 ----------------
def extract(file_path: str, file_type: str | None = None,
            passphrase: str | None = None) -> "ExtractResult":
    ext = (file_type or "").lower().lstrip(".") or file_path.rsplit(".", 1)[-1].lower()
    extractors = {
        "pdf": _extract_pdf,
        "docx": _extract_docx,
        "md": _extract_md,
        "markdown": _extract_md,
        "txt": _extract_txt,
        "epub": _extract_epub,
    }
    if ext not in extractors:
        raise ParseError(f"不支持的文件类型 .{ext}（支持 pdf/docx/md/txt/epub）")
    if ext == "pdf":
        return _extract_pdf(file_path, passphrase)
    return extractors[ext](file_path)


class ExtractResult:
    def __init__(self):
        self.pages: list = []      # [(page_no, text)]，DOCX/MD/TXT 页码为 None
        self.toc: list = []        # [(level, title, page_no|None)]
        self.word_count: int = 0

    @property
    def full_text(self) -> str:
        return "\n".join(t for _, t in self.pages)

    @property
    def text_ratio(self) -> float:
        """文本提取率：用于检测扫描件（PDF）。"""
        total = sum(max(len(t), 1) for _, t in self.pages)
        if not self.pages:
            return 0.0
        nonempty = sum(1 for _, t in self.pages if t.strip())
        return nonempty / len(self.pages)


def _extract_pdf(path: str, passphrase: str | None = None) -> ExtractResult:
    try:
        import pymupdf as fitz  # PyMuPDF
    except ImportError:
        raise ParseError("缺少 PyMuPDF：pip install PyMuPDF")
    res = ExtractResult()
    try:
        doc = fitz.open(path)
    except Exception as e:
        raise ParseError(f"PDF 打开失败（可能加密或损坏）：{e}")
    if getattr(doc, "needs_pass", False):
        if not passphrase:
            doc.close()
            raise ParseError("PDF 已加密：请在导入时填写打开口令")
        if not doc.authenticate(passphrase):
            doc.close()
            raise ParseError("PDF 口令错误，无法打开")
    res.pages = [(i + 1, page.get_text().strip()) for i, page in enumerate(doc)]
    res.word_count = sum(len(t) for _, t in res.pages)
    # PDF 书签 → 章节树
    for lvl, title, page in doc.get_toc():
        res.toc.append((lvl, title.strip(), int(page)))
    doc.close()
    if res.text_ratio < 0.05:
        logger.warning("疑似扫描件 PDF（文本提取率 < 5%%），建议启用 OCR")
    return res


def _extract_docx(path: str) -> ExtractResult:
    try:
        from docx import Document
    except ImportError:
        raise ParseError("缺少 python-docx：pip install python-docx")
    res = ExtractResult()
    doc = Document(path)
    buf: list[str] = []
    for para in doc.paragraphs:
        style = (para.style.name or "") if para.style else ""
        text = para.text.strip()
        if not text:
            continue
        m = re.match(r"^Heading\s+(\d)$", style)
        if m:
            res.toc.append((int(m.group(1)), text, None))
        buf.append(text)
    res.pages = [(None, "\n".join(buf))]
    res.word_count = len(buf)
    return res


def _extract_md(path: str) -> ExtractResult:
    res = ExtractResult()
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    res.pages = [(None, text)]
    res.word_count = len(text)
    for line in text.splitlines():
        m = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if m:
            res.toc.append((len(m.group(1)), m.group(2).strip(), None))
    return res


def _extract_txt(path: str) -> ExtractResult:
    res = ExtractResult()
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    res.pages = [(None, text)]
    res.word_count = len(text)
    return res


def _extract_epub(path: str) -> ExtractResult:
    try:
        from ebooklib import epub
    except ImportError:
        raise ParseError("缺少 ebooklib：pip install ebooklib")
    from html.parser import HTMLParser

    class _TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts: list[str] = []
            self._heads: list = []
            self._current_tag = ""

        def handle_starttag(self, tag, attrs):
            self._current_tag = tag
            if tag in ("h1", "h2", "h3"):
                self._heads.append(tag)

        def handle_data(self, data):
            self.parts.append(data)

    res = ExtractResult()
    book = epub.read_epub(path)
    buf: list[str] = []
    # 必须按 spine（阅读顺序）遍历：get_items() 是内部条目序，章节会乱序
    for idref, _linear in book.spine:
        item = book.get_item_with_id(idref)
        if item is None or item.get_type() != 9:  # ITEM_DOCUMENT
            continue
        html = item.get_content().decode("utf-8", errors="replace")
        p = _TextExtractor()
        try:
            p.feed(html)
        except Exception:
            continue
        text = re.sub(r"\s+", " ", "".join(p.parts)).strip()
        if text:
            buf.append(text)
        # 从 h 标签粗略提取标题
        for m in re.finditer(r"<(h[1-3])[^>]*>(.*?)</\1>", html, re.S):
            title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            if title:
                res.toc.append((int(m.group(1)[1]), title, None))
    res.pages = [(None, "\n\n".join(buf))]
    res.word_count = sum(len(t) for t in buf)
    return res


# ---------------- 结构识别与切分 ----------------
def build_chapter_tree(result: ExtractResult) -> list[dict]:
    """返回 [{title, level, page_start, page_end, text, structure}]"""
    if result.toc:
        return _from_toc(result)
    return _auto_split(result)


def _from_toc(result: ExtractResult) -> list[dict]:
    sections = []
    toc = sorted(result.toc, key=lambda e: (e[2] or 0))
    for i, (lvl, title, page) in enumerate(toc):
        next_page = toc[i + 1][2] if i + 1 < len(toc) else None
        text = _pages_between(result, page, next_page)
        sections.append({
            "title": title or "未命名章节",
            "level": max(1, min(6, lvl)),
            "page_start": page,
            "page_end": (next_page - 1) if next_page else None,
            "text": text,
            "structure": "doc",
        })
    return sections


def _pages_between(result: ExtractResult, start: int | None, end: int | None) -> str:
    if start is None:
        return result.full_text
    parts = []
    for page_no, text in result.pages:
        if page_no is not None and start <= page_no and (end is None or page_no < end):
            parts.append(text)
    return "\n".join(parts)


def _auto_split(result: ExtractResult) -> list[dict]:
    """无原生结构：按字数阈值在段落边界切分。"""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", result.full_text) if p.strip()]
    sections: list[dict] = []
    cur: list[str] = []
    cur_chars = 0

    def flush(idx: int):
        if not cur:
            return
        text = "\n\n".join(cur)
        first = cur[0][:40]
        sections.append({
            "title": f"第 {idx} 节 · {first}{'…' if len(cur[0]) > 40 else ''}",
            "level": 1,
            "page_start": None,
            "page_end": None,
            "text": text,
            "structure": "auto",
        })

    idx = 1
    for p in paragraphs:
        cur.append(p)
        cur_chars += len(p)
        if cur_chars >= AUTO_SPLIT_CHARS:
            flush(idx)
            idx += 1
            cur, cur_chars = [], 0
    flush(idx)
    return sections


# ---------------- 段落块化 ----------------
def split_chunks(section_text: str, page_map: list | None = None, heading_path: str = "") -> list[dict]:
    """把章节正文切成段落块。page_map: [(page_no, page_text)] 用于页码归属；
    无页码信息时全部标为 None。块不跨页。"""
    chunks = []
    if page_map:
        for page_no, page_text in page_map:
            for para in _split_paragraphs(page_text):
                chunks.append({"para_no": 0, "page_no": page_no, "content": para, "heading_path": heading_path})
    else:
        for para in _split_paragraphs(section_text):
            chunks.append({"para_no": 0, "page_no": None, "content": para, "heading_path": heading_path})
    # 合并过短段落 / 拆分过长段落
    merged: list[dict] = []
    for c in chunks:
        if merged and len(merged[-1]["content"]) + len(c["content"]) < CHUNK_MAX_CHARS // 2:
            merged[-1]["content"] += "\n" + c["content"]
        elif len(c["content"]) > CHUNK_MAX_CHARS:
            for piece in _split_long(c["content"]):
                merged.append({**c, "content": piece})
        else:
            merged.append(c)
    for i, c in enumerate(merged, 1):
        c["para_no"] = i
        c["token_count"] = max(1, len(c["content"]) // 2)
    return merged


def _split_paragraphs(text: str) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) <= 1:  # PDF 页面常为单段落流，按行分组
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        group, groups = [], []
        for l in lines:
            group.append(l)
            if sum(len(x) for x in group) > CHUNK_MAX_CHARS // 2:
                groups.append("\n".join(group))
                group = []
        if group:
            groups.append("\n".join(group))
        return groups or ([text] if text else [])
    return paras


def _split_long(text: str) -> list[str]:
    # 按句子切分超长段落
    sentences = re.split(r"(?<=[。！？!?])\s*", text)
    pieces, cur = [], ""
    for s in sentences:
        if len(cur) + len(s) > CHUNK_MAX_CHARS and cur:
            pieces.append(cur)
            cur = s
        else:
            cur += s
    if cur:
        pieces.append(cur)
    return pieces


def file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()
