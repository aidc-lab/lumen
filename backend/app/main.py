"""FastAPI 应用入口（sidecar）。仅监听 127.0.0.1，令牌认证。"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import SIDECAR_INFO_PATH
from app.core.db import init_db
from app.core.logging import setup_logging
from app.services.jobs import jobs as job_manager

TOKEN = os.environ.get("LUMEN_TOKEN", "")


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """本地令牌认证：Authorization: Bearer <token> 或 ?token=<token>。"""

    async def dispatch(self, request, call_next):
        if TOKEN:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {TOKEN}" and request.query_params.get("token") != TOKEN:
                return JSONResponse(
                    {"error": {"code": "E_AUTH", "message": "未授权"}}, status_code=401)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    init_db()
    job_manager.set_loop(asyncio.get_running_loop())
    job_manager.recover()
    # 供 Electron 读取（run.py 也会写，这里兜底）
    try:
        import json
        from app.core.config import APP_DIR
        info = SIDECAR_INFO_PATH.read_text() if SIDECAR_INFO_PATH.exists() else ""
        if not info:
            SIDECAR_INFO_PATH.write_text(json.dumps({
                "port": os.environ.get("LUMEN_PORT", ""),
                "token": TOKEN,
            }))
    except Exception:
        pass
    yield


app = FastAPI(title="lumen sidecar", version="1.1.0", lifespan=lifespan)
app.add_middleware(TokenAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.routes import router  # noqa: E402

app.include_router(router, prefix="/api/v1")

# 生产模式：托管前端构建产物（frontend/dist）。
# 在模块加载时挂载（路由按注册顺序匹配，/api/v1 优先）。
from pathlib import Path  # noqa: E402

from fastapi.staticfiles import StaticFiles  # noqa: E402

_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists() and (_dist / "index.html").exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="static")
    print(f"[lumen] serving frontend from {_dist}")
