"""日志配置：本地文件 + 轮转，无远程遥测。"""
import logging
from logging.handlers import RotatingFileHandler

from .config import APP_DIR


def setup_logging() -> None:
    log_path = APP_DIR / "lumen.log"
    handler = RotatingFileHandler(log_path, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger("app")
    root.setLevel(logging.INFO)
    root.addHandler(handler)
