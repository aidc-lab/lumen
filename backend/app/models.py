"""SQLAlchemy 数据模型（对应设计文档 §7）。"""
import enum
import json
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import PrimaryKeyConstraint

from app.core.db import Base


class TextbookStatus(str, enum.Enum):
    pending = "pending"
    parsing = "parsing"
    parsed = "parsed"
    failed = "failed"


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    cover_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    term: Mapped[str] = mapped_column(String(100), default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Textbook(Base):
    __tablename__ = "textbooks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    file_path: Mapped[str] = mapped_column(String(500))
    file_type: Mapped[str] = mapped_column(String(10))
    file_hash: Mapped[str] = mapped_column(String(64), default="")
    file_passphrase_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    ocr_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    structure_source: Mapped[str] = mapped_column(String(20), default="auto")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Chapter(Base):
    __tablename__ = "chapters"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    textbook_id: Mapped[str] = mapped_column(String(36), ForeignKey("textbooks.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    level: Mapped[int] = mapped_column(Integer, default=1)
    path: Mapped[str] = mapped_column(String(500), default="")
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text, default="")
    structure: Mapped[str] = mapped_column(String(20), default="auto")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ChapterChunk(Base):
    """段落块：向量化与引用的最小单元。"""

    __tablename__ = "chapter_chunks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    para_no: Mapped[int] = mapped_column(Integer, default=0)
    page_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heading_path: Mapped[str] = mapped_column(String(500), default="")
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)


class KnowledgePoint(Base):
    __tablename__ = "knowledge_points"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(20), default="auto")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)


class Exercise(Base):
    __tablename__ = "exercises"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(10))          # single/multi/judge/fill/short/calc/essay
    difficulty: Mapped[int] = mapped_column(Integer, default=3)
    stem: Mapped[str] = mapped_column(Text)
    options: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    answer: Mapped[str] = mapped_column(Text, default="")
    explanation: Mapped[str] = mapped_column(Text, default="")
    source_refs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    quality_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Paper(Base):
    __tablename__ = "papers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    duration_min: Mapped[int] = mapped_column(Integer, default=30)
    total_score: Mapped[int] = mapped_column(Integer, default=100)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PaperQuestion(Base):
    __tablename__ = "paper_questions"
    paper_id: Mapped[str] = mapped_column(String(36), ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    exercise_id: Mapped[str] = mapped_column(String(36), ForeignKey("exercises.id", ondelete="CASCADE"), primary_key=True)
    order: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[int] = mapped_column(Integer, default=10)


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(String(36), ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")
    config_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Answer(Base):
    __tablename__ = "answers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("exercises.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text, default="")
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ai_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_feedback: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    regraded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WrongEntry(Base):
    """错题本条目：用户/系统将某题加入课程错题本。"""
    __tablename__ = "wrong_entries"
    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("exercises.id", ondelete="CASCADE"), index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (PrimaryKeyConstraint("course_id", "question_id"),)


class Summary(Base):
    __tablename__ = "summaries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LessonPlan(Base):
    __tablename__ = "lesson_plans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(300), default="新会话")
    scope: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    mode: Mapped[str] = mapped_column(String(20), default="direct")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Model(Base):
    """模型配置：云端 API 或用户自建（Ollama/LM Studio），统一 OpenAI 兼容协议。"""

    __tablename__ = "models"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(100), default="OpenAI 兼容")
    base_url: Mapped[str] = mapped_column(String(500))
    api_key_enc: Mapped[str] = mapped_column(Text, default="")
    capabilities: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # ["text","vision","long_context","embedding"]
    context_length: Mapped[int] = mapped_column(Integer, default=8192)
    max_output: Mapped[int] = mapped_column(Integer, default=4096)
    default_for: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # {"答疑": true, ...}
    status: Mapped[str] = mapped_column(String(20), default="unknown")
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_type: Mapped[str] = mapped_column(String(50), index=True)
    name: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    variables: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    model_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)


class AITask(Base):
    __tablename__ = "ai_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_type: Mapped[str] = mapped_column(String(50), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result_ref: Mapped[str] = mapped_column(String(500), default="")
    model_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("models.id", ondelete="SET NULL"), nullable=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_est: Mapped[float] = mapped_column(Float, default=0.0)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


def parse_setting(value: str) -> str:
    """读取 Setting.value：兼容早期用 json.dumps 写入的字符串（两侧带双引号）。"""
    if value[:1] == '"':
        try:
            v = json.loads(value)
            if isinstance(v, str):
                return v
        except Exception:
            pass
    return value
