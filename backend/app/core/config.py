"""lumen 应用目录与路径配置。数据全部落在本地（local-first）。"""
import os
import sys
from pathlib import Path

APP_NAME = "lumen"


def _app_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        base = home / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share"))
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


APP_DIR = _app_dir()
DB_PATH = APP_DIR / "lumen.db"
FILES_DIR = APP_DIR / "files"          # 导入的教材原文、导出物
FILES_DIR.mkdir(exist_ok=True)
SIDECAR_INFO_PATH = APP_DIR / "sidecar.json"  # 端口/令牌，供 Electron 读取
