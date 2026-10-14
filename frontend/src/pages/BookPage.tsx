import { useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { View } from '../App'
import type { Chapter, ChapterDetail, Course, Textbook } from '../types'

interface Props {
  go: (v: View) => void
}

export default function BookPage({ go }: Props) {
  const toast = useContext(ToastContext)
  const [courses, setCourses] = useState<Course[]>([])
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [detail, setDetail] = useState<ChapterDetail | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [cur, setCur] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<{ id: string; content: string; version: number }[]>([])

  useEffect(() => {
    ;(async () => {
      const [c, t] = await Promise.all([
        api.get<Course[]>('/api/v1/courses'),
        api.get<Textbook[]>('/api/v1/textbooks'),
      ])
      setCourses(c)
      setTextbooks(t)
      if (t[0]) loadChapters(t[0].id)
    })().catch((e) => toast('加载失败：' + e.message))
  }, [toast])

  async function loadChapters(textbookId: string) {
    const rows = await api.get<Chapter[]>(`/api/v1/textbooks/${textbookId}/chapters`)
    setChapters(rows)
    setOpen(Object.fromEntries(rows.filter((r) => r.level === 1).map((r) => [r.id, true])))
    if (rows[0]) selectChapter(rows[0].id)
  }

  async function selectChapter(id: string) {
    setCur(id)
    const d = await api.get<ChapterDetail>(`/api/v1/chapters/${id}`)
    setDetail(d)
    const s = await api.get<{ id: string; content: string; version: number }[]>(
      `/api/v1/chapters/${id}/summaries`
    )
    setSummaries(s)
  }

  const tree = useMemo(() => {
    const roots = chapters.filter((c) => !c.parent_id)
    const childrenOf = (pid: string) => chapters.filter((c) => c.parent_id === pid)
    return roots.map((r) => ({ root: r, children: childrenOf(r.id) }))
  }, [chapters])

  return (
    <>
      <div className="page-head">
        <h1>📖 教材浏览</h1>
        <select value={textbooks[0]?.id ?? ''} onChange={(e) => loadChapters(e.target.value)}>
          {textbooks.map((t) => (
            <option key={t.id} value={t.id}>{t.title}（{t.status}）</option>
          ))}
        </select>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => cur && api.post(`/api/v1/chapters/${cur}/revector`).then(() => toast('重新索引任务已提交')).catch((e) => toast(e.message))}>
          ⟳ 重新向量化
        </button>
      </div>
      <div className="toolbar">
        <button className="btn btn-sm" onClick={() => go('wizard')}>🧙 出题</button>
        <button className="btn btn-sm" onClick={async () => {
          if (!cur) return toast('请先选择章节')
          try {
            const t = await api.post<{ id: string }>('/api/v1/summaries/generate', { chapter_id: cur })
            toast('总结任务已提交 → 任务中心')
            go('tasks')
          } catch (e) { toast('生成失败：' + (e as Error).message) }
        }}>📝 总结</button>
        <button className="btn btn-sm" onClick={() => go('qa')}>💬 答疑</button>
        <button className="btn btn-sm" onClick={() => go('quiz')}>⏱️ 测验</button>
      </div>
      <div className="book-layout" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}><b>教材目录</b></div>
          <div className="tree card-pad" style={{ paddingTop: 6 }}>
            {tree.map(({ root, children }) => (
              <div key={root.id}>
                <div className={`tree-item ${cur === root.id ? 'active' : ''}`}
                  onClick={() => selectChapter(root.id)}>
                  <span className={`arrow ${open[root.id] ? 'open' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [root.id]: !o[root.id] })) }}>▸</span>
                  <span>{root.title}</span>
                  <span className="meta">{root.page_start ? `p.${root.page_start}` : ''}</span>
                </div>
                {open[root.id] && (
                  <div className="tree-children">
                    {children.map((c) => (
                      <div key={c.id} className={`tree-item ${cur === c.id ? 'active' : ''}`}
                        onClick={() => selectChapter(c.id)}>
                        <span style={{ width: 14 }} />
                        <span>{c.title}</span>
                        <span className="meta">{c.page_start ? `p.${c.page_start}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          {detail ? (
            <>
              <div className="content-head">
                <h2>{detail.title}</h2>
                <div className="meta">
                  <span>{detail.page_start != null ? `p.${detail.page_start}${detail.page_end ? `-${detail.page_end}` : ''}` : '无页码信息'}</span>
                  <span>¶{detail.chunks.length} 段</span>
                  <span>{detail.word_count.toLocaleString()} 字</span>
                  <span className="tag accent">结构来源：{detail.structure === 'doc' ? '文档原生' : '自动切分'}</span>
                </div>
              </div>
              {detail.chunks.map((c) => (
                <div className="para" key={c.id}>
                  <div className="pno">{c.page_no != null ? `p.${c.page_no}` : ''}¶{c.para_no}</div>
                  <div className="ptext">{c.content}</div>
                  <button className="cite-btn"
                    onClick={() => { navigator.clipboard?.writeText(`${detail.title} ¶${c.para_no}${c.page_no ? ` p.${c.page_no}` : ''}`); toast('引用已复制') }}>
                    引用
                  </button>
                </div>
              ))}
              {summaries.length > 0 && (
                <>
                  <div className="content-head" style={{ borderTop: '1px solid var(--border)' }}>
                    <h2 style={{ fontSize: 15 }}>📝 知识总结（{summaries.length} 版本）</h2>
                  </div>
                  {summaries.map((s) => (
                    <div className="para" key={s.id}>
                      <div className="ptext" style={{ whiteSpace: 'pre-wrap' }}>{s.content}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <div className="empty">选择章节查看内容</div>
          )}
        </div>
      </div>
    </>
  )
}
