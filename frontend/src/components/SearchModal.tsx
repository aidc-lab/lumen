import { useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { CourseContext } from '../App'
import type { NavTarget } from '../App'
import type { SearchResult } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  go: (v: NavTarget) => void
}

/** 全局搜索（⌘K）：跨教材全文检索，点击结果跳到对应章节。 */
export default function SearchModal({ open, onClose, go }: Props) {
  const { course, setCourseId, setFocusChapter } = useContext(CourseContext)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'all' | 'course'>('all')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setQ('')
    setResults([])
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (!query) { setResults([]); setLoading(false); return }
    const id = ++seq.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const useCourse = scope === 'course' && course
        const r = await api.get<SearchResult[]>(
          `/api/v1/search?q=${encodeURIComponent(query)}&k=20` +
          (useCourse ? `&course_id=${encodeURIComponent(course.id)}` : ''))
        if (id === seq.current) setResults(r)
      } catch {
        if (id === seq.current) setResults([])
      } finally {
        if (id === seq.current) setLoading(false)
      }
    }, 240)
    return () => clearTimeout(timer)
  }, [q, scope, open, course])

  if (!open) return null

  function openResult(r: SearchResult) {
    if (r.course_id) setCourseId(r.course_id)
    setFocusChapter(r.chapter_id)
    go('book')
    onClose()
  }

  return (
    <div className="modal-mask search-mask" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrap">
          <span className="search-ico">🔍</span>
          <input
            ref={inputRef}
            value={q}
            placeholder="搜索教材内容、章节标题…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) openResult(results[0])
              if (e.key === 'Escape') onClose()
            }}
          />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>ESC</button>
        </div>
        <div className="search-scope">
          <button className={`fchip ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>全部课程</button>
          <button className={`fchip ${scope === 'course' ? 'on' : ''}`} onClick={() => setScope('course')}
            disabled={!course}>
            当前课程{course ? ` · ${course.name}` : ''}
          </button>
          <span className="search-hint">Enter 打开第一条结果</span>
        </div>
        <div className="search-results">
          {loading && <div className="search-empty">检索中…</div>}
          {!loading && q.trim() && results.length === 0 && (
            <div className="search-empty">没有找到匹配内容，试试其他关键词</div>
          )}
          {!q.trim() && (
            <div className="search-empty">输入关键词，跨课程检索教材原文；结果可一键定位到章节</div>
          )}
          {results.map((r) => (
            <div key={`${r.chunk_id}`} className="search-result" onClick={() => openResult(r)}>
              <div className="sr-head">
                <span className="sr-book">《{r.textbook_title}》</span>
                <span className="sr-chapter">{r.chapter_title}</span>
                {r.page_no != null && <span className="tag">p.{r.page_no}</span>}
                <span className="sr-score">相关度 {(r.score * 100).toFixed(0)}</span>
              </div>
              <div className="sr-snippet">{r.snippet}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
