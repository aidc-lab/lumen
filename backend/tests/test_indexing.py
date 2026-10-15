"""索引服务回归测试：空章节（封面/扉页等无正文标题页）不得导致 FTS 插入崩溃。

背景：rebuild_chapter_index 对空章节产生空 chunk 列表，
空 executemany 会触发 sqlite3 "A value is required for bind parameter"。
"""
import uuid

import pytest

from app.core.db import SessionLocal
from app.models import Chapter, Textbook
from app.services import indexing


@pytest.fixture(scope="module")
def empty_chapter_id():
    """借第一个教材创建一个空章节（测试后清理）。"""
    with SessionLocal() as db:
        tb = db.query(Textbook).first()
        if tb is None:
            pytest.skip("数据库无教材，跳过")
        ch = Chapter(id=uuid.uuid4().hex, textbook_id=tb.id, parent_id=None,
                     title="空章节回归测试", level=1, path="空章节回归测试",
                     word_count=0, content="", structure="auto")
        db.add(ch)
        db.commit()
        yield ch.id
        db.delete(db.get(Chapter, ch.id))
        db.commit()


def test_rebuild_empty_chapter_index(empty_chapter_id):
    import asyncio
    n = asyncio.run(indexing.rebuild_chapter_index(empty_chapter_id))
    assert n == 0  # 无 chunk，不抛异常即通过（修复前此处崩）
