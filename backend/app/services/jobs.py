"""异步任务队列：表驱动、状态机、进度广播（SSE）、可取消、断点信息持久化。"""
import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import AITask

logger = logging.getLogger("app.jobs")

# 协程工厂签名：(job) -> Awaitable[str]  返回 result_ref
CoroFactory = Callable[[Any], Awaitable[str]]


@dataclass
class Job:
    id: str
    task_type: str
    status: str = "pending"
    progress: float = 0.0
    params: dict = field(default_factory=dict)
    result_ref: str = ""
    model_id: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    cost_est: float = 0.0
    error: str = ""
    logs: list = field(default_factory=list)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    _cancel: asyncio.Event = field(default_factory=asyncio.Event)
    _task: asyncio.Task | None = None
    _queues: list = field(default_factory=list)  # SSE 订阅者队列

    def set_progress(self, pct: float, log: str | None = None):
        self.progress = max(0.0, min(100.0, pct))
        if log:
            self.logs.append(["", log])
            self._broadcast("task.log")
        self._broadcast("task.progress")

    def log(self, msg: str, level: str = ""):
        self.logs.append([level, msg])
        self._broadcast("task.log")

    def check_cancelled(self):
        if self._cancel.is_set():
            raise asyncio.CancelledError()

    def _broadcast(self, event: str):
        payload = {"event": event, "data": self.to_dict()}
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:  # pragma: no cover
                pass

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "task_type": self.task_type,
            "status": self.status,
            "progress": round(self.progress, 1),
            "params": self.params,
            "result_ref": self.result_ref,
            "model_id": self.model_id or None,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "cost_est": self.cost_est,
            "error": self.error,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "created_at": self.created_at.isoformat(),
            "logs": self.logs,
        }


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """由 lifespan 注入事件循环（同步端点在线程池中运行，无 running loop）。"""
        self._loop = loop

    def create(self, task_type: str, params: dict, factory: CoroFactory, model_id: str = "") -> Job:
        job = Job(id=uuid.uuid4().hex, task_type=task_type, params=params, model_id=model_id)
        self.jobs[job.id] = job
        if self._loop is not None:
            # 线程安全：跨线程调度协程
            asyncio.run_coroutine_threadsafe(self._run(job, factory), self._loop)
        else:
            asyncio.get_running_loop().create_task(self._run(job, factory))
        return job

    async def _run(self, job: Job, factory: CoroFactory):
        job.status = "running"
        job.started_at = datetime.utcnow()
        self._persist(job)
        job._broadcast("task.progress")
        try:
            result_ref = await factory(job)
            job.status = "completed"
            job.progress = 100.0
            # result_ref 统一为字符串（列表等结构序列化为 JSON）
            if isinstance(result_ref, str):
                job.result_ref = result_ref
            elif result_ref:
                job.result_ref = json.dumps(result_ref, ensure_ascii=False)
            else:
                job.result_ref = ""
        except asyncio.CancelledError:
            job.status = "canceled"
            job.log("已取消", "warn")
        except Exception as e:
            job.status = "failed"
            job.error = f"{type(e).__name__}: {e}"
            job.log(f"✗ {job.error}", "err")
            logger.exception("job %s failed", job.id)
        finally:
            job.finished_at = datetime.utcnow()
            self._persist(job)
            job._broadcast("task.done" if job.status == "completed" else "task.error")

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job or job.status != "running":
            return False
        job._cancel.set()
        if job._task:
            job._task.cancel()
        return True

    def subscribe(self, job_id: str) -> asyncio.Queue:
        job = self.jobs.get(job_id)
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        if job:
            job._queues.append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue):
        job = self.jobs.get(job_id)
        if job and q in job._queues:
            job._queues.remove(q)

    def _persist(self, job: Job):
        try:
            with SessionLocal() as db:
                row = db.get(AITask, job.id)
                if row is None:
                    row = AITask(id=job.id)
                    db.add(row)
                row.task_type = job.task_type
                row.status = job.status
                row.params = job.params
                row.result_ref = job.result_ref
                row.model_id = job.model_id or None
                row.tokens_in = job.tokens_in
                row.tokens_out = job.tokens_out
                row.cost_est = job.cost_est
                row.progress = job.progress
                row.error = job.error
                row.started_at = job.started_at
                row.finished_at = job.finished_at
                db.commit()
        except Exception:
            logger.exception("job persist failed")

    def recover(self):
        """启动时把上次未完成的任务标记为中断。"""
        with SessionLocal() as db:
            for row in db.scalars(select(AITask).where(AITask.status.in_(["pending", "running"]))):
                row.status = "failed"
                row.error = "应用退出，任务中断"
            db.commit()

    def list_recent(self, limit: int = 50) -> list[Job]:
        return sorted(self.jobs.values(), key=lambda j: j.created_at, reverse=True)[:limit]


jobs = JobManager()
