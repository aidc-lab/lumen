import { useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL, type Exercise } from '../types'

export interface QItem {
  id: string
  type: string
  stem: string
  options: unknown[] | null
  difficulty: number
  score: number
  order: number
  user_answer: string | string[] | null
}

interface Props {
  go: (v: NavTarget) => void
  courseId: string
  questions: QItem[]
  attemptId: string
  paper: { title: string; duration_min: number }
  onFinish: () => void
}

export default function DoingPanel({ go, courseId, questions, attemptId, paper, onFinish }: Props) {
  const toast = useContext(ToastContext)
  const [qs, setQs] = useState<QItem[]>(questions)
  const [cur, setCur] = useState(0)
  const [result, setResult] = useState<{ score: number; total_score: number } | null>(null)
  const [left, setLeft] = useState(paper.duration_min * 60)
  const [submitting, setSubmitting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  useEffect(() => {
    if (paper.duration_min <= 0) return
    timerRef.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) { doSubmit() }
        return l - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function setAnswer(idx: number, val: string | string[]) {
    setQs((items) => items.map((q, i) => (i === idx ? { ...q, user_answer: val } : q)))
  }

  async function doSubmit() {
    if (timerRef.current) clearInterval(timerRef.current)
    setSubmitting(true)
    const items = qs
    const answers: Record<string, string> = {}
    for (const q of qs) {
      answers[q.id] = Array.isArray(q.user_answer) ? q.user_answer.join(',') : (q.user_answer ?? '')
    }
    try {
      const r = await api.post<{ score: number; total_score: number; grading_task_id?: string }>(
        `/api/v1/attempts/${attemptId}/submit`, answers)
      setResult({ score: r.score, total_score: r.total_score })
      sessionStorage.setItem('lumen-last-attempt', attemptId)
      if (r.grading_task_id) {
        toast(`客观题 ${r.score} 分；主观题 AI 阅卷中 → 任务中心/成绩单`)
      } else {
        toast(`已提交：${r.score}/${r.total_score} 分`)
      }
      onFinish()
    } catch (e) {
      setSubmitting(false)
      toast('提交失败：' + (e as Error).message)
    }
  }

  const q = qs[cur]

  if (result) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <h3 style={{ marginBottom: 10 }}>{paper.title} · 作答完成</h3>
        <div style={{ fontSize: 34, fontWeight: 800, margin: '10px 0' }}>
          {result.score} / {result.total_score} 分
        </div>
        <p style={{ color: 'var(--muted)', marginBottom: 18 }}>
          客观题已自动判分；主观题如标记“待阅卷”将在 AI 阅卷完成后更新成绩单。
        </p>
        <button className="btn btn-primary" onClick={() => go('report')}>查看成绩单 →</button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>📝 {paper.title}</h1>
        <span className="sub">共 {qs.length} 题 · 作答中</span>
        <div className="spacer" />
        {paper.duration_min > 0 && (
          <div className={`timer ${left < 60 ? 'urgent' : ''}`}>{fmt(Math.max(left, 0))}</div>
        )}
        <button className="btn btn-primary" disabled={submitting} onClick={doSubmit}>
          {submitting ? '提交中…' : '提交答卷'}
        </button>
      </div>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="qnav">
          {qs.map((qq, i) => (
            <button key={i} className={`${i === cur ? 'cur' : ''} ${qq.user_answer ? 'done' : ''}`}
              onClick={() => setCur(i)}>{i + 1}</button>
          ))}
        </div>
      </div>
      {q && (
        <div className="card question-card">
          <div className="qhead">
            <span className={`qtype ${q.type}`}>{QTYPE_LABEL[q.type]}</span>
            <span className="tag">{q.score} 分</span>
            <span className="tag">难度 {q.difficulty}</span>
          </div>
          <div className="stem">{cur + 1}. {q.stem}</div>
          {Array.isArray(q.options) && q.type !== 'judge' ? (
            (q.options as unknown[]).map((o) => {
              const text = String(o)
              const sel = Array.isArray(q.user_answer)
                ? q.user_answer.includes(text)
                : q.user_answer === text
              return (
                <div key={text} className={`opt ${sel ? 'sel' : ''}`}
                  onClick={() => {
                    if (q.type === 'multi') {
                      const cur2 = Array.isArray(q.user_answer) ? q.user_answer : []
                      setAnswer(cur, cur2.includes(text) ? cur2.filter((x) => x !== text) : [...cur2, text])
                    } else {
                      setAnswer(cur, text)
                    }
                  }}>
                  <span className="key">{text[0]}</span>
                  <span>{text.slice(2)}</span>
                </div>
              )
            })
          ) : q.type === 'judge' ? (
            ['√ 正确', '× 错误'].map((o) => (
              <div key={o} className={`opt ${q.user_answer === o ? 'sel' : ''}`} onClick={() => setAnswer(cur, o)}>
                <span className="key">{o[0]}</span>
                <span>{o.slice(2)}</span>
              </div>
            ))
          ) : (
            <textarea className="answer" placeholder="在此作答…"
              value={(q.user_answer as string) ?? ''}
              onChange={(e) => setAnswer(cur, e.target.value)} />
          )}
        </div>
      )}
      {!q && <div className="card empty">该试卷暂无题目</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button className="btn" disabled={cur === 0} onClick={() => setCur(cur - 1)}>← 上一题</button>
        <button className="btn btn-primary" disabled={cur === qs.length - 1} onClick={() => setCur(cur + 1)}>下一题 →</button>
      </div>
    </>
  )
}
