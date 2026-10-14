"""Pydantic 请求/响应模式。"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


# ---- 课程 ----
class CourseBase(BaseModel):
    name: str
    subject: str = ""
    description: str = ""
    term: str = ""


class CourseCreate(CourseBase):
    pass


class CourseUpdate(BaseModel):
    name: str | None = None
    subject: str | None = None
    description: str | None = None
    term: str | None = None
    status: str | None = None


class CourseOut(CourseBase):
    id: str
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---- 教材 ----
class TextbookImport(BaseModel):
    course_id: str
    file_path: str
    title: str | None = None
    file_type: str | None = None
    passphrase: str | None = None


class TextbookOut(BaseModel):
    id: str
    course_id: str
    title: str
    file_path: str
    file_type: str
    status: str
    page_count: int
    word_count: int
    structure_source: str
    error: str | None = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---- 章节 ----
class ChapterOut(BaseModel):
    id: str
    textbook_id: str
    parent_id: str | None = None
    title: str
    level: int
    page_start: int | None = None
    page_end: int | None = None
    word_count: int
    structure: str
    model_config = ConfigDict(from_attributes=True)


class ChapterDetail(ChapterOut):
    content: str
    chunks: list["ChunkOut"] = []


class ChunkOut(BaseModel):
    id: int
    chapter_id: str
    para_no: int
    page_no: int | None = None
    content: str
    model_config = ConfigDict(from_attributes=True)


class ChapterUpdate(BaseModel):
    title: str | None = None
    parent_id: str | None = None


# ---- 搜索 ----
class SearchResult(BaseModel):
    chunk_id: int
    chapter_id: str
    chapter_title: str
    textbook_title: str
    page_no: int | None = None
    para_no: int
    snippet: str
    score: float


# ---- 任务 ----
class TaskOut(BaseModel):
    id: str
    task_type: str
    status: str
    progress: float
    error: str
    params: dict[str, Any] | None = None
    result_ref: str = ""
    model_id: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_est: float = 0.0
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    logs: list[list[str]] = []


# ---- 模型 ----
class ModelCreate(BaseModel):
    name: str
    provider: str = "OpenAI 兼容"
    base_url: str
    api_key: str = ""
    capabilities: list[str] = ["text"]
    context_length: int = 8192
    max_output: int = 4096


class ModelUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    capabilities: list[str] | None = None
    context_length: int | None = None
    max_output: int | None = None
    default_for: dict[str, bool] | None = None


class ModelOut(BaseModel):
    id: str
    name: str
    provider: str
    base_url: str
    capabilities: list[str] = []
    context_length: int
    max_output: int
    default_for: dict[str, bool] | None = None
    status: str
    last_tested_at: datetime | None = None
    has_key: bool = False
    model_config = ConfigDict(from_attributes=True)


class ModelTestResult(BaseModel):
    ok: bool
    detail: str
    latency_ms: int


# ---- 总结 ----
class SummaryGenerate(BaseModel):
    chapter_id: str
    model_id: str | None = None


class SummaryOut(BaseModel):
    id: str
    chapter_id: str
    content: str
    version: int
    model_id: str | None = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ---- 习题 ----
class ExerciseGenerate(BaseModel):
    course_id: str
    chapter_ids: list[str] = []
    textbook_id: str | None = None
    types: dict[str, int] = {}
    difficulty: int = 3
    explain: bool = True
    answer: bool = True
    model_id: str | None = None


class ExerciseOut(BaseModel):
    id: str
    course_id: str
    chapter_id: str | None = None
    type: str
    difficulty: int
    stem: str
    options: list | None = None
    answer: str
    explanation: str
    source_refs: list | None = None
    model_id: str | None = None
    status: str
    quality_rating: int | None = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ExerciseUpdate(BaseModel):
    stem: str | None = None
    options: dict | None = None
    answer: str | None = None
    explanation: str | None = None
    difficulty: int | None = None
    status: str | None = None
    quality_rating: int | None = None


# ---- 试卷 ----
class PaperCreate(BaseModel):
    course_id: str
    title: str
    exercise_ids: list[str]
    duration_min: int = 30
    shuffle: bool = True
    seed: int | None = None


# ---- 答疑 ----
class SessionCreate(BaseModel):
    course_id: str | None = None
    title: str = "新会话"
    scope: dict[str, Any] | None = None
    mode: str = "direct"


class SessionOut(BaseModel):
    id: str
    course_id: str | None = None
    title: str
    scope: dict[str, Any] | None = None
    mode: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    citations: dict | None = None
    model_id: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ChatIn(BaseModel):
    content: str


# ---- 设置 ----
class SettingsOut(BaseModel):
    settings: dict[str, Any]
