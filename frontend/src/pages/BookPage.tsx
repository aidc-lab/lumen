import { useContext, useEffect, useState } from 'react'
import { api, openSSE } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import type { Chapter, ChapterDetail, Textbook } from '../types'
import Markdown from '../components/Markdown'

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

/** 章节视图：原文 / 总结 / 教案 */
type ChapterView = 'text' | 'summary' | 'plan'

export default function BookPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [books, setBooks] = useState<Textbook[]>([])
  const [chaptersByBook, setChaptersByBook] = useState<Record<string, Chapter[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [cur, setCur] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChapterDetail | null>(null)
  const [summaries, setSummaries] = useState<{ id: string; content: string; version: number }[]>([])
  const [plans, setPlans] = useState<{ id: string; content: string; version: number }[]>([])
  const [chapterView, setChapterView] = useState<ChapterView>('text')
  const [gen, setGen] = useState<{ kind: ChapterView; id: string } | null>(null)
  const [deleting, setDeleting] = useState<Textbook | null>(null)

  async function selectChapter(id: string) {
    setCur(id)
    setChapterView('text')
    setGen(null)
    const d = await api.get<ChapterDetail>(`/api/v1/chapters/${id}`)
    setDetail(d)
    setSummaries(await api.get<{ id: string; content: string; version: number }[]>(
      `/api/v1/chapters/${id}/summaries`
    ))
    setPlans(await api.get<{ id: string; content: string; version: number }[]>(
      `/api/v1/chapters/${id}/lesson-plans`
    ))
  }

  async function loadBooks() {
    try {
      const t = await api.get<Textbook[]>(`/api/v1/textbooks?course_id=${courseId}`)
      setBooks(t)
      const map: Record<string, Chapter[]> = {}
      for (const b of t) {
        map[b.id] = await api.get<Chapter[]>(`/api/v1/textbooks/${b.id}/chapters`)
      }
      setChaptersByBook(map)
      setExpanded(Object.fromEntries(t.map((b) => [b.id, true])))
      const rootOpen: Record<string, boolean> = {}
      for (const rows of Object.values(map)) {
        // 默认展开所有根章节（不限 level：EPUB 的章可能是 L2）
        for (const c of rows.filter((r) => !r.parent_id)) rootOpen[c.id] = true
      }
      setOpen(rootOpen)
      const first = t[0] ? map[t[0].id]?.[0] : null
      if (first) await selectChapter(first.id)
      else { setDetail(null); setCur(null); setSummaries([]); setPlans([]) }
    } catch (e) { toast('加载失败：' + (e as Error).message) }
  }

  async function deleteBook() {
    if (!deleting) return
    try {
      const inThisBook = (chaptersByBook[deleting.id] || []).some((c) => c.id === cur)
      await api.del(`/api/v1/textbooks/${deleting.id}`)
      if (inThisBook) { setCur(null); setDetail(null) }
      setDeleting(null)
      toast('教材已删除')
      await loadBooks()
    } catch (e) { toast('删除失败：' + (e as Error).message) }
  }

  /** 生成知识总结 / 教案：SSE 跟踪任务，完成后自动刷新对应列表 */
  async function genKind(kind: 'summary' | 'plan') {
    if (!detail) return
    const path = kind === 'summary' ? '/api/v1/summaries/generate' : '/api/v1/lesson-plans/generate'
    try {
      const t = await api.post<{ id: string }>(path, { chapter_id: detail.id })
      setGen({ kind: kind === 'summary' ? 'summary' : 'plan', id: t.id })
      toast('生成任务已提交，完成后自动展示')
      const finish = (err?: string) => {
        es.close()
        poll && clearInterval(poll)
        setGen(null)
        if (err) {
          toast('生成失败：' + err)
        } else if (detail) {
          const chId = detail.id
          const listPath = `/api/v1/chapters/${chId}/${kind === 'summary' ? 'summaries' : 'lesson-plans'}`
          api.get<{ id: string; content: string; version: number }[]>(listPath)
            .then((rows) => kind === 'summary' ? setSummaries(rows) : setPlans(rows))
            .catch(() => {})
        }
      }
      const es = openSSE(`/api/v1/tasks/${t.id}/events`, (ev, data) => {
        // 连接时先推当前状态快照（task.progress）：任务可能已秒完成
        if (ev === 'task.error') {
          finish(data?.error || data?.message || '未知错误')
        } else if (ev === 'task.done') {
          finish()
        } else if (ev === 'task.progress' && data?.status && data.status !== 'running') {
          // 快照即终态（任务在 SSE 连接建立前已完成）
          finish(data.status === 'failed' ? (data.error || '未知错误') : undefined)
        }
      })
      // 轮询兜底：SSE 丢事件（如 sidecar 重启）时也能收尾
      const poll = setInterval(async () => {
        try {
          const task = await api.get<{ status: string; error: string }>(`/api/v1/tasks/${t.id}`)
          if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
            finish(task.status !== 'completed' ? (task.error || '未知错误') : undefined)
          }
        } catch { clearInterval(poll); setGen(null) }
      }, 5000)
    } catch (e) { toast('生成失败：' + (e as Error).message) }
  }

  useEffect(() => { if (courseId) loadBooks() }, [courseId])

  async function importFiles() {
    const w = window as any
    // Electron 模式：系统文件对话框（支持多选，本地路径直传）
    if (w.electron?.openFileDialog) {
      const paths: string[] = await w.electron.openFileDialog()
      if (!paths || paths.length === 0) return
      let ok = 0
      for (const p of paths) {
        try {
          await api.post('/api/v1/textbooks/import', { course_id: courseId, file_path: p })
          ok++
        } catch (e) { toast(`导入失败：${(e as Error).message}`) }
      }
      if (ok > 0) {
        toast(`已提交 ${ok} 个导入任务 → 任务中心`)
        go('tasks')
      }
      return
    }
    // Web 模式：文件选择 + multipart 上传
    document.querySelector<HTMLInputElement>('#import-file-book')?.click()
  }

  async function onWebFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    let ok = 0
    for (const f of Array.from(files)) {
      const fd = new FormData()
      fd.append('course_id', courseId)
      fd.append('file', f)
      try {
        await api.post('/api/v1/textbooks/upload', fd)
        ok++
      } catch (err) { toast(`导入失败：${(err as Error).message}`) }
    }
    if (ok > 0) {
      toast(`已提交 ${ok} 个导入任务 → 任务中心`)
      go('tasks')
    }
    e.target.value = ''
  }

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('courses')}>返回我的课程</button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>📖 教材浏览</h1>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={importFiles}>📥 导入教材</button>
        <input id="import-file-book" type="file" accept=".pdf,.docx,.md,.txt,.epub" multiple
          style={{ display: 'none' }} onChange={onWebFiles} />
        <button className="btn btn-sm" onClick={loadBooks} aria-label="刷新教材列表">⟳</button>
        <button className="btn btn-sm" onClick={() => cur && api.post(`/api/v1/chapters/${cur}/revector`).then(() => toast('重新索引任务已提交')).catch((e) => toast(e.message))}>
          ⟳ 重新向量化
        </button>
      </div>
      <div className="book-layout" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <b>教材目录</b>
            <span className="sub" style={{ marginLeft: 8 }}>{books.length} 本</span>
          </div>
          {books.map((b) => {
            const rows = chaptersByBook[b.id] || []
            const roots = rows.filter((c) => !c.parent_id)
            const childrenOf = (pid: string) => rows.filter((c) => c.parent_id === pid)
            return (
              <div key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                <div className="book-head">
                  <span className={`arrow ${expanded[b.id] ? 'open' : ''}`}
                    onClick={() => setExpanded((o) => ({ ...o, [b.id]: !o[b.id] }))}>▸</span>
                  <span className="book-title" onClick={() => setExpanded((o) => ({ ...o, [b.id]: !o[b.id] }))}>{b.title}</span>
                  <span className={`tag ${b.status === 'parsed' ? 'ok' : b.status === 'failed' ? 'danger' : ''}`}>
                    {b.status === 'parsed' ? '已就绪' : b.status}
                  </span>
                  <button className="btn btn-ghost btn-sm btn-danger"
                    title="删除教材"
                    onClick={() => setDeleting(b)}>删除</button>
                </div>
                {expanded[b.id] && (
                  <div className="tree card-pad" style={{ paddingTop: 4, paddingBottom: 10 }}>
                    {roots.map((r) => (
                      <div key={r.id}>
                        <div className={`tree-item ${cur === r.id ? 'active' : ''}`}
                          onClick={() => selectChapter(r.id)}>
                          <span className={`arrow ${open[r.id] ? 'open' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [r.id]: !o[r.id] })) }}>▸</span>
                          <span>{r.title}</span>
                          <span className="meta">{r.page_start ? `p.${r.page_start}` : ''}</span>
                        </div>
                        {open[r.id] && (
                          <div className="tree-children">
                            {childrenOf(r.id).map((c) => (
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
                    {rows.length === 0 && (
                      <div style={{ color: 'var(--faint)', fontSize: 12.5, padding: '4px 0' }}>
                        {b.status === 'parsing' ? '解析中…' : b.status === 'failed' ? `解析失败：${b.error || ''}` : '暂无章节'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {books.length === 0 && (
            <div className="card-pad" style={{ color: 'var(--faint)', fontSize: 12.5 }}>
              暂无教材 —— 点击「导入教材」开始
            </div>
          )}
        </div>
        <div className="card">
          {detail ? (
            <>
              <div className="content-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2>{detail.title}</h2>
                  <div className="meta">
                    <span>{detail.page_start != null ? `p.${detail.page_start}${detail.page_end ? `-${detail.page_end}` : ''}` : '无页码信息'}</span>
                    <span>¶{detail.chunks.length} 段</span>
                    <span>{detail.word_count.toLocaleString()} 字</span>
                    <span className="tag accent">结构来源：{detail.structure === 'doc' ? '文档原生' : '自动切分'}</span>
                  </div>
                </div>
              </div>
              <div className="chapter-views">
                <button className={`cview ${chapterView === 'text' ? 'active' : ''}`}
                  onClick={() => setChapterView('text')}>📄 原文</button>
                <button className={`cview ${chapterView === 'summary' ? 'active' : ''}`}
                  onClick={() => setChapterView('summary')}>📝 总结</button>
                <button className={`cview ${chapterView === 'plan' ? 'active' : ''}`}
                  onClick={() => setChapterView('plan')}>📚 教案</button>
              </div>

              {/* 原文视图 */}
              {chapterView === 'text' && detail.chunks.map((c) => (
                <div className="para" key={c.id}>
                  <div className="pno">{c.page_no != null ? `p.${c.page_no}` : ''}¶{c.para_no}</div>
                  <div className="ptext">{c.content}</div>
                  <button className="cite-btn"
                    onClick={() => { navigator.clipboard?.writeText(`${detail.title} ¶${c.para_no}${c.page_no ? ` p.${c.page_no}` : ''}`); toast('引用已复制') }}>
                    引用
                  </button>
                </div>
              ))}
              {chapterView === 'text' && detail.chunks.length === 0 && (
                <div className="card-pad" style={{ color: 'var(--faint)' }}>本章节无正文</div>
              )}

              {/* 总结视图 */}
              {chapterView === 'summary' && (
                gen?.kind === 'summary' ? (
                  <GenSkeleton label="✨ 知识总结生成中…" />
                ) : summaries.length > 0 ? (
                  <div className="card-pad gen-pad">
                    <div className="gen-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => genKind('summary')}
                        disabled={gen !== null}>⟳ 重新生成</button>
                    </div>
                    <Markdown content={summaries[0].content} />
                  </div>
                ) : (
                  <div className="gen-empty">
                    <p>本章节还没有知识总结</p>
                    <button className="btn btn-primary" onClick={() => genKind('summary')}
                      disabled={gen !== null}>📝 生成知识总结</button>
                  </div>
                )
              )}

              {/* 教案视图 */}
              {chapterView === 'plan' && (
                gen?.kind === 'plan' ? (
                  <GenSkeleton label="✨ 教案生成中…" />
                ) : plans.length > 0 ? (
                  <div className="card-pad gen-pad">
                    <div className="gen-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => genKind('plan')}
                        disabled={gen !== null}>⟳ 重新生成</button>
                    </div>
                    <Markdown content={plans[0].content} />
                  </div>
                ) : (
                  <div className="gen-empty">
                    <p>本章节还没有教案</p>
                    <button className="btn btn-primary" onClick={() => genKind('plan')}
                      disabled={gen !== null}>📚 生成教案</button>
                  </div>
                )
              )}
            </>
          ) : (
            <div className="empty">
              {books.length === 0
                ? '暂无教材 —— 点击「导入教材」开始'
                : '选择章节查看内容'}
            </div>
          )}
        </div>
      </div>
      {deleting && (
        <div className="modal-mask" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除教材</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
              确认删除教材「{deleting.title}」？<br />
              其章节、总结、教案与索引将一并删除，此操作不可恢复。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDeleting(null)}>取消</button>
              <button className="btn btn-danger" onClick={deleteBook}>删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** 生成中骨架屏（过渡动画） */
function GenSkeleton({ label }: { label: string }) {
  return (
    <div className="card-pad">
      <div className="gen-label">{label}</div>
      {[88, 95, 72, 90, 64].map((w, i) => (
        <div key={i} className="skeleton" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  )
}
