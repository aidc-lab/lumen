"""Sidecar 启动器：分配随机端口与一次性令牌，打印 READY 行后运行 uvicorn。

Electron 主进程通过 stdout 的 JSON 行获知端口与令牌。
"""
import json
import os
import secrets
import socket
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = int(os.environ.get("LUMEN_PORT") or _free_port())
    token = os.environ.get("LUMEN_TOKEN") or secrets.token_urlsafe(32)
    os.environ["LUMEN_TOKEN"] = token

    from app.core.config import SIDECAR_INFO_PATH
    SIDECAR_INFO_PATH.write_text(json.dumps({"port": port, "token": token}))

    print(json.dumps({"type": "ready", "port": port, "token": token}), flush=True)

    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
