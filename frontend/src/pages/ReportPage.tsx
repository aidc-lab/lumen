import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { View } from '../App'
import { QTYPE_LABEL } from '../types'

interface ReportItem {
  answer_id: string
  question_id: string
  type: string
  stem: string
  options: Record<string, unknown> | null
  answer: string
  explanation: string
  user_answer: string
  is_correct: boolean | null
  ai_score: number | null
  ai_feedback: {
    max_score?: number
    points?: { desc: string; obtained: number }[]
    deductions?: { reason: string; points: number }[]
    suggestions?: string[]
    [k: string]: unknown
  } | null
}

export default function ReportPage({ go }: { go: (v: View) => void }) {
  const toast = useContext(ToastContext)
  const [attempts, setAttempts] = useState<{ id: string; score: number | null; status: string; paper_id: string }[]>([])
  const [report, setReport] = useState<{ score: number | null; items: ReportItem[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      // 列出最近作答记录（通过任务/试卷间接获取；P0 简化：尝试常见 attempt id 不可行，
      // 这里展示最近提交的成绩单入口）
      try {
        const tasks = await api.get<{ id: string; task_type: string; result_ref: string; status: string }[]>(
          '/api/v1/tasks?limit=100'
        )
        setAttempts([])
        void tasks
      } catch (e) { setError(String(e)) }
    })().catch(() => {})
  }, [])

  // 最近一次提交的答卷（QuizPage 提交后导航到这里，带 attempt id）
  useEffect(() => {
    const id = sessionStorage.getItem('lumen-last-attempt')
    if (!id) return
    ;(async () => {
      try {
        const r = await api.get<{ attempt_id: string; score: number | null; items: ReportItem[] }>(
          `/api/v1/attempts/${id}/report`
        )
        setReport({ score: r.score, items: r.items })
        setError('')
      } catch (e) { setError(String(e)) }
    })()
  }, [])

  const correct = report?.items.filter((i) => i.is_correct === true).length ?? 0
  const wrong = report?.items.filter((i) => i.is_correct === false).length ?? 0
  const pending = report?.items.filter((i) => i.is_correct === null).length ?? 0

  return (
    <>
      <div className="page-head">
        <h1>📊 成绩单</h1>
        <span className="sub">客观题自动判分 · 主观题 AI 阅卷为 P2 能力</span>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!report ? (
        <div className="card empty">
          暂无测验记录<br /><br />
          <button className="btn btn-primary" onClick={() => go('quiz')}>开始一次测验 →</button>
        </div>
      ) : (
        <div className="report-grid">
          <div>
            <div className="card card-pad" style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>客观题得分</div>
              <div style={{ fontSize: 40, fontWeight: 800, margin: '8px 0' }}>{report.score ?? '—'}</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 14, fontSize: 12.5, color: 'var(--muted)' }}>
                <span>✓ 正确 <b style={{ color: 'var(--ok)' }}>{correct}</b></span>
                <span>✗ 错误 <b style={{ color: 'var(--danger)' }}>{wrong}</b></span>
                <span>⏳ 待阅卷 <b style={{ color: 'var(--warn)' }}>{pending}</b></span>
              </div>
            </div>
            <div className="card card-pad" style={{ marginTop: 14 }}>
              <h4 style={{ marginBottom: 8 }}>说明</h4>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.8 }}>
                · 客观题（单选/多选/判断）已自动判分<br />
                · 主观题 AI 阅卷、知识点掌握度雷达图为 P2 能力<br />
                · 错题本为 P3 能力
              </div>
            </div>
          </div>
          <div className="card">
            {report.items.map((it, i) => (
              <div className="fb-item" key={i}>
                <div className="fb-head">
                  <span className={`qtype ${it.type}`}>{QTYPE_LABEL[it.type]}</span>
                  <span style={{ fontWeight: 500 }}>{i + 1}. {it.stem}</span>
                  {it.is_correct === true && <span className="tag ok">✓ 正确</span>}
                  {it.is_correct === false && <span className="tag danger">✗ 错误</span>}
                  {it.is_correct === null && <span className="tag warn">待阅卷</span>}
                  <span className="fb-score">{it.ai_score != null ? `${it.ai_score} 分` : ''}</span>
                </div>
                <div className="fb-text">
                  你的答案：<b>{it.user_answer || '（未作答）'}</b><br />
                  {it.is_correct === false && <>参考答案：<b>{it.answer}</b><br />{(it.ai_feedback?.explanation as string) || it.explanation ? `解析：${(it.ai_feedback?.explanation as string) || it.explanation}` : ''}</>}
                  {/* 主观题阅卷反馈（P2） */}
                  {(it.type === 'short' || it.type === 'calc' || it.type === 'essay') && it.ai_feedback && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 600 }}>
                        AI 阅卷：{it.ai_score ?? '—'} / {it.ai_feedback.max_score ?? '—'} 分
                        {it.ai_score == null && <span className="tag warn" style={{ marginLeft: 8 }}>待阅卷</span>}
                      </div>
                      {it.ai_feedback.points?.map((p, j) => (
                        <div key={j} style={{ color: 'var(--ok)', fontSize: 12.5 }}>✓ {p.desc}（+{p.obtained}）</div>
                      ))}
                      {it.ai_feedback.deductions?.map((d, j) => (
                        <div key={j} style={{ color: 'var(--danger)', fontSize: 12.5 }}>✗ {d.reason}（-{d.points}）</div>
                      ))}
                      {it.ai_feedback.suggestions?.map((s, j) => (
                        <div key={j} style={{ color: 'var(--muted)', fontSize: 12.5 }}>💡 {s}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
