import { useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { View } from '../App'
import { QTYPE_LABEL, type Course, type Exercise } from '../types'

interface Props {
  go: (v: View) => void
}

interface QWithAnswer extends Exercise {
  user_answer: string | string[] | null
  score: number
}

export default function QuizPage({ go }: Props) {
  const toast = useContext(ToastContext)
  const [courses, setCourses] = useState<Course[]>([])
  const [bank, setBank] = useState<Exercise[]>([])
  const [questions, setQuestions] = useState<QWithAnswer[]>([])
  const [paperId, setPaperId] = useState<string | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [cur, setCur] = useState(0)
  const [result, setResult] = useState<{ score: number; total_score: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const questionsRef = useRef<QWithAnswer[]>([])
  const attemptRef = useRef<string | null>(null)
  questionsRef.current = questions

  useEffect(() => {
    ;(async () => {
      const [c, b] = await Promise.all([
        api.get<Course[]>('/api/v1/courses'),
        api.get<Exercise[]>('/api/v1/exercises?status=published'),
      ])
      setCourses(c)
      setBank(b)
    })().catch((e) => toast('加载失败：' + e.message))
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [toast])

  async function start() {
    if (bank.length === 0) return toast('题库为空 —— 先生成并发布题目')
    const picked = [...bank].slice(0, 10)
    const ids = picked.map((q) => q.id)
    try {
      const paper = await api.post<{ id: string; total_score: number; count: number }>(
        '/api/v1/papers',
        { course_id: courses[0]?.id ?? '', title: '阶段测验', exercise_ids: ids, duration_min: 10, shuffle: true }
      )
      const attempt = await api.post<{ id: string; duration_min: number }>(`/api/v1/papers/${paper.id}/attempts`)
      setPaperId(paper.id)
      setAttemptId(attempt.id)
      attemptRef.current = attempt.id
      setLeft(attempt.duration_min * 60)
      setQuestions(picked.map((q) => ({ ...q, user_answer: null, score: 0 })))
      setResult(null)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setLeft((l) => {
          if (l <= 1) { doSubmit() }
          return l - 1
        })
      }, 1000)
    } catch (e) { toast('开始失败：' + (e as Error).message) }
  }

  function setAnswer(idx: number, val: string | string[]) {
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, user_answer: val } : q)))
  }

  async function doSubmit() {
    const attemptId = attemptRef.current
    const qs = questionsRef.current
    if (!attemptId || qs.length === 0) return
    if (timerRef.current) clearInterval(timerRef.current)
    const answers: Record<string, string> = {}
    for (const q of qs) {
      answers[q.id] = Array.isArray(q.user_answer) ? q.user_answer.join(',') : (q.user_answer ?? '')
    }
    try {
      const r = await api.post<{ attempt_id: string; score: number; total_score: number }>(
        `/api/v1/attempts/${attemptId}/submit`, answers
      )
      setResult({ score: r.score, total_score: r.total_score })
      sessionStorage.setItem('lumen-last-attempt', attemptId)
      toast(`已提交：客观题 ${r.score}/${r.total_score} 分，主观题待 AI 阅卷（P2）`)
      go('report')
    } catch (e) { toast('提交失败：' + (e as Error).message) }
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const q = questions[cur]

  return (
    <>
      <div className="page-head">
        <h1>⏱️ 测验</h1>
        {questions.length > 0 && (
          <>
            <div className={`timer ${left < 60 ? 'urgent' : ''}`}>{fmt(Math.max(left, 0))}</div>
            <span className="tag">共 {questions.length} 题</span>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={doSubmit}>提交答卷</button>
          </>
        )}
      </div>
      {questions.length === 0 ? (
        <div className="card card-pad">
          <h3>开始测验</h3>
          <p style={{ color: 'var(--muted)' }}>
            从已发布题库随机抽取 {Math.min(10, bank.length)} 题组成测验（客观题自动判分，主观题 AI 阅卷为 P2 能力）。
          </p>
          <p style={{ color: 'var(--muted)' }}>题库中已发布题目：{bank.length} 题</p>
          <button className="btn btn-primary" onClick={start} disabled={bank.length === 0}>
            开始测验（{Math.min(10, bank.length)} 题 · 10 分钟）
          </button>
        </div>
      ) : (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="qnav">
              {questions.map((qq, i) => (
                <button key={i} className={`${i === cur ? 'cur' : ''} ${qq.user_answer ? 'done' : ''}`}
                  onClick={() => setCur(i)}>{i + 1}</button>
              ))}
            </div>
          </div>
          {q && (
            <div className="card question-card">
              <div className="qhead">
                <span className={`qtype ${q.type}`}>{QTYPE_LABEL[q.type]}</span>
                <span className="tag">10 分</span>
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
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn" disabled={cur === 0} onClick={() => setCur(cur - 1)}>← 上一题</button>
            <button className="btn" disabled={cur === questions.length - 1} onClick={() => setCur(cur + 1)}>下一题 →</button>
          </div>
        </>
      )}
      {result && <div className="card card-pad" style={{ marginTop: 14 }}>
        已提交：<b>{result.score}</b> / {result.total_score} 分（客观题）。查看成绩单 →
      </div>}
    </>
  )
}
