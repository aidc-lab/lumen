import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL, type Attempt } from '../types'

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

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

export default function ReportPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [detail, setDetail] = useState<{
    score: number | null
    total_score: number
    paper_title: string | null
    status: string
    items: ReportItem[]
  } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [regrading, setRegrading] = useState<string | null>(null)

  async function refresh() {
    if (!courseId) { setAttempts([]); return }
    try {
      setAttempts(await api.get<Attempt[]>(`/api/v1/attempts?course_id=${courseId}`))
      setError('')
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => {
    // 兼容：刚提交完答卷的 attempt，刷新列表并直接打开其报告
    const last = sessionStorage.getItem('lumen-last-attempt')
    refresh().then(() => {
      if (last) {
        sessionStorage.removeItem('lumen-last-attempt')
        openReport(last)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  const openReport = async (id: string) => {
    setDetailId(id)
    try {
      const r = await api.get<{
        attempt_id: string
        score: number | null
        total_score: number
        paper_title: string | null
        status: string
        items: ReportItem[]
      }>(`/api/v1/attempts/${id}/report`)
      setDetail({
        score: r.score,
        total_score: r.total_score ?? 0,
        paper_title: r.paper_title,
        status: r.status,
        items: r.items,
      })
    } catch (e) { toast('加载报告失败：' + (e as Error).message) }
  }

  // 主观题 AI 阅卷是异步任务：报告未完成时自动轮询，完成后自动刷新
  useEffect(() => {
    if (!detailId || !detail) return
    const pending = detail.items.some((i) => i.is_correct === null)
    if (!pending) return
    const timer = setInterval(() => { openReport(detailId) }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, detail?.status, detail?.items])

  async function regrade(answerId: string) {
    setRegrading(answerId)
    try {
      await api.patch(`/api/v1/answers/${answerId}/regrade`)
      toast('已重新评阅')
      if (detailId) await openReport(detailId)
    } catch (e) {
      toast('重评失败：' + (e as Error).message)
    } finally {
      setRegrading(null)
    }
  }

  const fmt = (s: string | null) => {
    if (!s) return '—'
    return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('home')}>返回首页</button>
      </div>
    )
  }

  if (detailId && detail !== null) {
    const correct = detail.items.filter((i) => i.is_correct === true).length
    const wrong = detail.items.filter((i) => i.is_correct === false).length
    const pending = detail.items.filter((i) => i.is_correct === null).length
    const att = attempts.find((a) => a.id === detailId)
    return (
      <>
        <div className="page-head">
          <button className="btn btn-ghost btn-sm" onClick={() => { setDetailId(null); setDetail(null) }} >← 返回列表</button>
          <h1>📊 成绩单</h1>
          <span className="sub">{detail.paper_title ?? att?.paper_title ?? '作答记录'} · 共 {detail.items.length} 题</span>
          {pending > 0
            ? <span className="tag warn">阅卷中</span>
            : <span className="tag ok">已评分</span>}
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="card card-pad" style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>总分</div>
          <div style={{ fontSize: 40, fontWeight: 800, margin: '8px 0' }}>
            {detail.score ?? '—'}{detail.total_score > 0 && <span style={{ fontSize: 18, color: 'var(--muted)' }}> / {detail.total_score}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, fontSize: 12.5, color: 'var(--muted)' }}>
            <span>✓ 正确 <b style={{ color: 'var(--ok)' }}>{correct}</b></span>
            <span>✗ 错误 <b style={{ color: 'var(--danger)' }}>{wrong}</b></span>
            <span>⏳ 待阅卷 <b style={{ color: 'var(--warn)' }}>{pending}</b></span>
          </div>
        </div>
        <div className="card">
          {detail.items.map((it, i) => (
            <div className="fb-item" key={i}>
              <div className="fb-head">
                <span className={`qtype ${it.type}`}>{QTYPE_LABEL[it.type]}</span>
                <span style={{ fontWeight: 500 }}>{i + 1}. {it.stem}</span>
                {it.is_correct === true && <span className="tag ok">✓ 正确</span>}
                {it.is_correct === false && <span className="tag danger">✗ 错误</span>}
                {it.is_correct === null && <span className="tag warn">待阅卷</span>}
                <span className="fb-score">{it.ai_score != null ? `${it.ai_score} 分` : ''}</span>
                {['short', 'calc', 'essay'].includes(it.type) && (
                  <button className="btn btn-sm btn-ghost" disabled={regrading === it.answer_id}
                    onClick={() => regrade(it.answer_id)}>
                    {regrading === it.answer_id ? '重评中…' : '重新评阅'}
                  </button>
                )}
              </div>
              <div className="fb-text">
                你的答案：<b>{it.user_answer || '（未作答）'}</b><br />
                {it.is_correct === false && <>参考答案：<b>{it.answer}</b><br />{(it.ai_feedback?.explanation as string) || it.explanation ? `解析：${(it.ai_feedback?.explanation as string) || it.explanation}` : ''}</>}
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
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>📊 成绩单</h1>
        <span className="sub">{attempts.length} 条作答记录（含试卷测验与题库练习）</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => go('bank')}>去题库练习 →</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="card report-card">
        <table className="report-table">
          <thead>
            <tr>
              <th style={{ width: 46 }}>#</th>
              <th>试卷 / 练习</th>
              <th style={{ width: 80 }}>题数</th>
              <th style={{ width: 110 }}>得分</th>
              <th style={{ width: 100 }}>状态</th>
              <th style={{ width: 130 }}>作答时间</th>
              <th style={{ width: 96 }}></th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a, i) => {
              const isPractice = (a.paper_title || '').startsWith('练习')
              return (
                <tr key={a.id} onClick={() => openReport(a.id)}>
                  <td className="num">{i + 1}</td>
                  <td className="title">
                    {a.paper_title || '未知试卷'}
                    <span className={`tag ${isPractice ? '' : 'accent'}`}>{isPractice ? '练习' : '试卷'}</span>
                  </td>
                  <td>{a.question_count} 题</td>
                  <td className="score">{a.score == null ? '—' : `${a.score} / ${a.total_score}`}</td>
                  <td>
                    {a.status === 'graded'
                      ? <span className="tag ok">已评分</span>
                      : <span className="tag warn">待阅卷</span>}
                  </td>
                  <td className="time">{fmt(a.finished_at ?? a.started_at)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openReport(a.id) }}>查看报告</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {attempts.length === 0 && !error && (
          <div className="empty">
            暂无成绩记录 —— 完成一次试卷测验或题库练习并提交后，记录会显示在这里<br /><br />
            <button className="btn btn-primary" onClick={() => go('bank')}>去题库开始一次练习 →</button>
          </div>
        )}
      </div>
    </>
  )
}
