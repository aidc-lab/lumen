"""SQLite 引擎与会话。WAL 模式；可选加载 sqlite-vec 扩展。"""
import logging

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import DB_PATH

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

# ---- 可选：sqlite-vec（向量检索）。未安装时降级为仅 FTS5 全文检索 ----
VEC_AVAILABLE = False
try:
    import sqlite_vec

    # 验证扩展确实可加载（0.1.9+ API 为 load()，旧版为 load_connection()）
    import sqlite3 as _sqlite3

    _probe = _sqlite3.connect(":memory:")
    _probe.enable_load_extension(True)
    _load = getattr(sqlite_vec, "load_connection", None) or sqlite_vec.load
    _load(_probe)
    _probe.close()
    VEC_AVAILABLE = True
except Exception as e:
    logger.info(f"sqlite-vec 不可用：{e}（向量检索降级为仅 FTS5）")

# 嵌入向量维度（默认 bge-m3 的 1024 维；可在设置中调整并重建索引）
DEFAULT_EMBEDDING_DIM = 1024
EMBEDDING_DIM = DEFAULT_EMBEDDING_DIM  # 兼容旧引用


def get_embedding_dim() -> int:
    """运行时读取设置中的向量维度；未配置时回退默认值。"""
    try:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT value FROM settings WHERE key = 'embedding_dim'"
            )).first()
            raw = str(row[0]).strip().strip('"') if row else ""
            if raw.isdigit():
                dim = int(raw)
                if 1 <= dim <= 16384:
                    return dim
    except Exception:
        pass
    return DEFAULT_EMBEDDING_DIM


def recreate_vec_table(dim: int) -> None:
    """按新维度重建 vec_chunks（旧向量随 DROP 一起清除，需重新向量化）。"""
    if not VEC_AVAILABLE:
        return
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS vec_chunks"))
        conn.execute(text(
            f"CREATE VIRTUAL TABLE vec_chunks "
            f"USING vec0(chunk_id INTEGER PRIMARY KEY, "
            f"embedding float[{dim}] distance_metric=cosine)"
        ))


@event.listens_for(engine, "connect")
def _on_connect(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()
    if VEC_AVAILABLE:
        try:
            import sqlite_vec

            dbapi_conn.enable_load_extension(True)
            _load = getattr(sqlite_vec, "load_connection", None) or sqlite_vec.load
            _load(dbapi_conn)
        except Exception as e:  # pragma: no cover
            logger.warning(f"sqlite-vec 加载失败: {e}")


def init_db() -> None:
    from app.models import Base as _Base  # noqa: F401  注册全部表

    Base.metadata.create_all(bind=engine)
    dim = get_embedding_dim()
    with engine.begin() as conn:
        # FTS5 全文索引（unicode61 分词；CJK 文本在索引时逐字插空格，
        # 使任意长度的中文子串都能通过短语匹配命中）
        conn.execute(text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts "
            "USING fts5(chunk_id UNINDEXED, chapter_id UNINDEXED, content)"
        ))
        if VEC_AVAILABLE:
            conn.execute(text(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks "
                f"USING vec0(chunk_id INTEGER PRIMARY KEY, "
                f"embedding float[{dim}] distance_metric=cosine)"
            ))
