/** 领域类型（与后端 Pydantic 模式对应） */

export interface Course {
  id: string
  name: string
  subject: string
  description: string
  term: string
  status: string
  created_at: string
}

export interface Textbook {
  id: string
  course_id: string
  title: string
  file_path: string
  file_type: string
  status: string
  page_count: number
  word_count: number
  structure_source: string
  error: string | null
  created_at: string
}

export interface Chapter {
  id: string
  textbook_id: string
  parent_id: string | null
  title: string
  level: number
  path: string
  page_start: number | null
  page_end: number | null
  word_count: number
  structure: string
}

export interface Chunk {
  id: number
  chapter_id: string
  para_no: number
  page_no: number | null
  content: string
}

export interface ChapterDetail extends Chapter {
  content: string
  chunks: Chunk[]
}

export interface SearchResult {
  chunk_id: number
  chapter_id: string
  chapter_title: string
  textbook_id: string | null
  textbook_title: string
  course_id: string | null
  page_no: number | null
  para_no: number
  snippet: string
  score: number
}

export interface Task {
  id: string
  task_type: string
  status: string
  progress: number
  error: string
  params?: Record<string, unknown>
  result_ref: string
  model_id: string | null
  tokens_in: number
  tokens_out: number
  cost_est: number
  started_at: string | null
  finished_at: string | null
  created_at: string
  logs: [string, string][]
}

export interface ModelDef {
  id: string
  name: string
  provider: string
  base_url: string
  capabilities: string[]
  context_length: number
  max_output: number
  default_for: Record<string, boolean> | null
  status: string
  last_tested_at: string | null
  has_key: boolean
}

export interface Exercise {
  id: string
  course_id: string
  chapter_id: string | null
  type: string
  difficulty: number
  stem: string
  options: unknown[] | null
  answer: string
  explanation: string
  source_refs: unknown[] | null
  model_id: string | null
  status: string
  quality_rating: number | null
  created_at: string
}

export interface Summary {
  id: string
  chapter_id: string
  content: string
  version: number
  model_id: string | null
  created_at: string
}

export interface Session {
  id: string
  course_id: string | null
  title: string
  scope: Record<string, unknown> | null
  mode: string
  created_at: string
}

export interface Message {
  id: string
  session_id: string
  role: string
  content: string
  citations: { list?: Citation[]; refs?: string[] } | null
  model_id: string | null
  tokens_in: number
  tokens_out: number
  created_at: string
}

export interface Citation {
  textbook: string
  chapter: string
  page_no: number | null
  para_no: number
  snippet: string
  chunk_id: number
}

export interface ModelTestResult {
  ok: boolean
  detail: string
  latency_ms: number
}

/** 试卷 */
export interface Paper {
  id: string
  course_id: string
  title: string
  duration_min: number
  total_score: number
  created_at: string
  question_count: number
}

export interface PaperQuestionView {
  order: number
  score: number
  exercise_id: string
  type: string
  stem: string
  options: unknown[] | null
  difficulty: number
}

export interface PaperDetail {
  id: string
  title: string
  duration_min: number
  total_score: number
  questions: PaperQuestionView[]
}

/** 作答记录（成绩单数据源） */
export interface Attempt {
  id: string
  paper_id: string
  paper_title: string | null
  score: number | null
  total_score: number
  status: string
  started_at: string
  finished_at: string | null
  question_count: number
}

export const QTYPE_LABEL: Record<string, string> = {
  single: '单选', multi: '多选', judge: '判断', fill: '填空',
  short: '简答', calc: '计算', essay: '论述',
}
