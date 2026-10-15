import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL } from '../types'

interface WrongItem {
  question_id: string
  type: string
  stem: string
  options: unknown[] | null
  answer: string
  explanation: string
  wrong_count: number
}

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

export default function WrongPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [items, setItems] = useState<WrongItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!courseId) { setItems([]); return }
    ;(async () => {
      try {
        const r = await api.get<{ items: WrongItem[] }>(
          `/api/v1/courses/${courseId}/wrong-questions`)
        setItems(r.items)
        setError('')
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [courseId])

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('home')}>返回概览</button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>📕 错题本</h1>
        <span className="sub">{items.length} 题 · 按错误次数排序</span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => go('quiz')}>⏱️ 去测验</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {items.map((it, i) => (
        <div className="card question-card" key={it.question_id} style={{ marginBottom: 12 }}>
          <div className="qhead">
            <span className={`qtype ${it.type}`}>{QTYPE_LABEL[it.type] || it.type}</span>
            <span className="tag danger">错 {it.wrong_count} 次</span>
          </div>
          <div className="stem">{i + 1}. {it.stem}</div>
          {Array.isArray(it.options) && it.options.length > 0 && (
            <div className="opts">{it.options.map((o) => <div key={String(o)}>{String(o)}</div>)}</div>
          )}
          <div className="ans" style={{ marginTop: 8 }}>参考答案：{it.answer}</div>
          {it.explanation && <div className="exp">解析：{it.explanation}</div>}
        </div>
      ))}
      {items.length === 0 && !error && (
        <div className="card empty">暂无错题 —— 全部答对，或尚未完成带判分的测验</div>
      )}
    </>
  )
}
