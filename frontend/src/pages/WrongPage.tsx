import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { Course } from '../types'
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

export default function WrongPage() {
  const toast = useContext(ToastContext)
  const [courses, setCourses] = useState<Course[]>([])
  const [courseId, setCourseId] = useState('')
  const [items, setItems] = useState<WrongItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const c = await api.get<Course[]>('/api/v1/courses')
      setCourses(c)
      if (c[0]) setCourseId(c[0].id)
    })().catch((e) => toast('加载失败：' + e.message))
  }, [toast])

  useEffect(() => {
    if (!courseId) return
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

  return (
    <>
      <div className="page-head">
        <h1>📕 错题本</h1>
        <span className="sub">{items.length} 题 · 按错误次数排序</span>
        <div className="spacer" />
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
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
