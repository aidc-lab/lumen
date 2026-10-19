import { useContext, useEffect, useState } from 'react'
import { api, openSSE } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL, type Chapter, type Exercise, type ModelDef, type Paper, type Task } from '../types'
import DoingPanel, { type QItem } from '../components/DoingPanel'

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

interface PQ {
  id: string
  type: string
  stem: string
  options: unknown[] | null
  answer: string
  explanation: string
  difficulty: number
  score: number
  order: number
}

type Mode = 'list' | 'view' | 'doing'

interface PaperDetail {
  id: string
  title: string
  duration_min: number
  total_score: number
  questions: PQ[]
}

interface GenSpec {
  types: Record<string, number>
  difficulty: number
  explain: boolean
  answer: boolean
  model_id: string | null
}

export default function PaperPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [mode, setMode] = useState<Mode>('list')
  const [papers, setPapers] = useState<Paper[]>([])
  const [viewing, setViewing] = useState<PaperDetail | null>(null)
  const [doing, setDoing] = useState<{
    attemptId: string; questions: QItem[]; paper: { title: string; duration_min: number }
  } | null>(null)
  const [creating, setCreating] = useState(false)
  const [paperTitle, setPaperTitle] = useState('')
  const [showAnswer, setShowAnswer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deleting, setDeleting] = useState<Paper | null>(null)

  // 新建试卷：选教材范围 + AI 生成
  const [textbooks, setTextbooks] = useState<{ id: string; title: string }[]>([])
  const [chaptersByTb, setChaptersByTb] = useState<Record<string, Chapter[]>>({})
  const [selectedTextbooks, setSelectedTextbooks] = useState<Set<string>>(new Set())
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelDef[]>([])
  const [spec, setSpec] = useState<GenSpec>({
    types: { single: 3, multi: 3, judge: 2, fill: 2, short: 2 },
    difficulty: 3,
    explain: true,
    answer: true,
    model_id: null,
  })
  const [expandedTb, setExpandedTb] = useState<string | null>(null)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())

  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
    catch { return s }
  }

  async function loadPapers() {
    if (!courseId) return
    try {
      setPapers(await api.get<Paper[]>(`/api/v1/papers?course_id=${courseId}`))
    } catch (e) { toast('加载试卷失败：' + (e as Error).message) }
  }

  useEffect(() => { loadPapers() }, [courseId])

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('home')}>返回首页</button>
      </div>
    )
  }

  if (mode === 'doing' && doing) {
    return (
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>
        <div className="page-head">
          <button className="btn btn-ghost btn-sm" onClick={() => { setDoing(null); setMode('view'); setShowAnswer(false) }} >← 返回试卷</button>
          <h1>📝 去测验</h1>
        </div>
        <DoingPanel
          go={go} courseId={courseId}
          attemptId={doing.attemptId}
          questions={doing.questions}
          paper={doing.paper}
          onFinish={() => { setDoing(null); setMode('list'); go('report') }}
        />
      </div>
    )
  }

  return (
    <>
      {mode === 'list' && (
        <>
          <div className="page-head">
            <h1>📝 试卷</h1>
            <span className="sub">{papers.length} 份试卷</span>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={openCreate}>＋ 新建试卷</button>
          </div>
          <div className="paper-grid">
            {papers.map((p) => (
              <div className="card paper-card" key={p.id} style={{ cursor: 'pointer' }} onClick={() => openView(p.id)}>
                <h3>{p.title}</h3>
                <div className="caps">
                  <span className="tag">{p.question_count} 题</span>
                  <span className="tag accent">{p.total_score} 分</span>
                  <span className="tag">用时 {p.duration_min} 分钟</span>
                </div>
                <div className="meta">创建于 {fmtDate(p.created_at)}</div>
                <div className="paper-actions">
                  <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); startQuizById(p.id) }}>去测验</button>
                  <span className="def" />
                  <button className="btn btn-sm btn-ghost btn-danger" onClick={(e) => { e.stopPropagation(); setDeleting(p) }}>删除</button>
                </div>
              </div>
            ))}
            {papers.length === 0 && (
              <div className="empty-card">
                <div className="ec-ico">📝</div>
                <div className="ec-t">暂无试卷</div>
                <div className="ec-s">选择教材章节，由 AI 生成试卷；生成的题目会同步进入「题库」</div>
                <button className="btn btn-primary" onClick={openCreate}>＋ 新建试卷</button>
              </div>
            )}
          </div>
          {deleting && (
            <div className="modal-mask" onClick={() => setDeleting(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>删除试卷</h3>
                <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
                  确认删除试卷「{deleting.title}」？<br />
                  其作答记录与成绩单条目将一并删除，题库中的题目会保留；此操作不可恢复。
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn" onClick={() => setDeleting(null)}>取消</button>
                  <button className="btn btn-danger" onClick={delPaper}>删除</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'view' && viewing && (
        <>
          <div className="page-head">
            <button className="btn btn-ghost btn-sm" onClick={() => setMode('list')} >← 返回列表</button>
            <h1>📝 {viewing.title}</h1>
            <span className="sub">{viewing.questions.length} 题 · {viewing.total_score} 分 · 建议用时 {viewing.duration_min} 分钟</span>
            <div className="spacer" />
            <label className="switch-label">
              <span>参考答案与解析</span>
              <button
                type="button"
                className={`switch${showAnswer ? ' on' : ''}`}
                role="switch"
                aria-checked={showAnswer}
                onClick={() => setShowAnswer((v) => !v)}
              >
                <span className="knob" />
              </button>
            </label>
            <button className="btn btn-sm" onClick={() => window.print()}>🖨️ 打印</button>
            <button className="btn btn-primary" onClick={startQuiz}>去测验</button>
          </div>
          <div style={{ maxWidth: '860px', margin: '0 auto' }}>
            {viewing.questions.map((pq) => (
              <div className="card question-card" key={pq.id}>
                <div className="qhead">
                  <span className={`qtype ${pq.type}`}>{QTYPE_LABEL[pq.type]}</span>
                  <span className="tag">{pq.score} 分</span>
                  <span className="tag">难度 {pq.difficulty}</span>
                </div>
                <div className="stem">{pq.order}. {pq.stem}</div>
                {pq.type === 'judge' ? (
                  <div className="opts-list">
                    {(Array.isArray(pq.options) && pq.options.length > 0 ? pq.options.map((o) => String(o)) : ['√ 正确', '× 错误']).map((text) => (
                      <div className="opt static" key={text}>
                        <span className="key">{text[0]}</span>
                        <span>{text.slice(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : Array.isArray(pq.options) && pq.options.length > 0 && (
                  <div className="opts-list">
                    {pq.options.map((o) => String(o)).map((text) => (
                      <div className="opt static" key={text}>
                        <span className="key">{text[0]}</span>
                        <span>{text.slice(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {showAnswer && pq.answer && (
                  <div className="ans" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ok)' }}>
                    参考答案：{pq.answer}
                  </div>
                )}
                {showAnswer && pq.explanation && (
                  <div className="exp" style={{ marginTop: 4, fontSize: 12.5, color: 'var(--muted)' }}>
                    解析：{pq.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {creating && (
        <div className="modal-mask" onClick={closeCreate}>
          <div className="paper-create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pcm-head">
              <h3>新建试卷 · AI 生成</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeCreate}>关闭</button>
            </div>

            <div className="pcm-section">
              <label className="pcm-label">试卷名</label>
              <input className="pcm-input" value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} />
            </div>

            <div className="pcm-section">
              <label className="pcm-label">选择出题范围（教材章节，可多选）</label>
              <div className="tb-multi">
                {textbooks.map((tb) => (
                  <div key={tb.id} className="tb-card">
                    <div className="tb-head" onClick={() => toggleTbExpand(tb.id)}>
                      <input
                        type="checkbox"
                        checked={selectedTextbooks.has(tb.id)}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleTextbook(tb.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="tb-title">{tb.title}</span>
                      <span className="tb-arrow">{expandedTb === tb.id ? '▲' : '▼'}</span>
                    </div>
                    {expandedTb === tb.id && (
                      <div className="tb-chapters">
                        {chaptersByTb[tb.id] ? (
                          chaptersByTb[tb.id].length === 0 ? (
                            <div className="pcm-empty" style={{ padding: 10 }}>暂无章节</div>
                          ) : (
                            chaptersByTb[tb.id]
                              .filter((c) => c.level === 1)
                              .map((ch) => {
                                const kids = chaptersByTb[tb.id].filter((c) => c.parent_id === ch.id)
                                return (
                                  <div key={ch.id} className="chapter-group">
                                    <div
                                      className="chapter-row chapter-row-l1"
                                      onClick={() => toggleChapterExpand(ch.id)}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedChapters.has(ch.id)}
                                        onChange={(e) => {
                                          e.stopPropagation()
                                          toggleChapterSelection(ch.id)
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <span className="chapter-title">{ch.title}</span>
                                      {kids.length > 0 && (
                                        <span className="chapter-arrow">
                                          {expandedChapters.has(ch.id) ? '▲' : '▼'}
                                        </span>
                                      )}
                                      <span className="chapter-meta">
                                        {ch.page_start != null ? `p.${ch.page_start}` : ''} · {ch.word_count} 字
                                      </span>
                                    </div>
                                    {expandedChapters.has(ch.id) && kids.map((sub) => (
                                      <div
                                        key={sub.id}
                                        className="chapter-row chapter-row-sub"
                                        onClick={() => toggleChapterSelection(sub.id)}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={selectedChapters.has(sub.id)}
                                          onChange={(e) => {
                                            e.stopPropagation()
                                            toggleChapterSelection(sub.id)
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                        <span className="chapter-title">{sub.title}</span>
                                        <span className="chapter-meta">
                                          {sub.page_start != null ? `p.${sub.page_start}` : ''} · {sub.word_count} 字
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )
                              })
                          )
                        ) : (
                          <div className="chapter-loading">加载中…</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {textbooks.length === 0 && <div className="pcm-empty">该课程暂无教材，请先导入教材</div>}
              </div>
            </div>

            <div className="pcm-section">
              <label className="pcm-label">题型与数量</label>
              <div className="qtype-table">
                <div className="qtype-table-row qtype-table-header">
                  {['single', 'multi', 'judge', 'fill', 'short'].map((t) => (
                    <div key={t} className="qtype-table-cell">
                      {{
                        single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', short: '简答题',
                      }[t]}
                    </div>
                  ))}
                </div>
                <div className="qtype-table-row">
                  {['single', 'multi', 'judge', 'fill', 'short'].map((t) => (
                    <div key={t} className="qtype-table-cell">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={spec.types[t] || 0}
                        onChange={(e) => setTypeCount(t, +e.target.value || 0)}
                        className="qtype-count"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pcm-actions">
              <div className="pcm-model-inline">
                <label className="pcm-label-sm">模型</label>
                <select
                  className="model-select-inline"
                  value={spec.model_id || ''}
                  onChange={(e) => setSpec((s) => ({ ...s, model_id: e.target.value }))}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.provider}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginLeft: 'auto' }}></div>
              <button className="btn btn-ghost" onClick={closeCreate}>取消</button>
              <button
                className="btn btn-primary"
                disabled={generating || !spec.model_id || selectedChapters.size === 0 || !paperTitle}
                onClick={startGenerate}
              >
                {generating ? '⏳ 生成中…' : '⚡ 生成试卷'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  function openCreate() {
    if (!courseId) return
    setPaperTitle(`课程试卷 · ${new Date().toLocaleDateString('zh-CN')}`)
    setSelectedTextbooks(new Set())
    setSelectedChapters(new Set())
    setExpandedChapters(new Set())
    setExpandedTb(null)
    setChaptersByTb({})
    ;(async () => {
      try {
        const [t, m] = await Promise.all([
          api.get<{ id: string; title: string }[]>(`/api/v1/textbooks?course_id=${courseId}`),
          api.get<ModelDef[]>('/api/v1/models'),
        ])
        setTextbooks(t)
        const textModels = m.filter((x) => x.capabilities.includes('text'))
        setModels(textModels)
        if (textModels.length > 0) {
          setSpec((s) => ({ ...s, model_id: textModels[0].id }))
        }
      } catch (e) { toast('加载失败：' + (e as Error).message) }
    })()
    setCreating(true)
  }
  function closeCreate() { setCreating(false) }

  async function loadChapters(textbookId: string) {
    if (chaptersByTb[textbookId]) return
    try {
      const rows = await api.get<Chapter[]>(`/api/v1/textbooks/${textbookId}/chapters`)
      setChaptersByTb((prev) => ({ ...prev, [textbookId]: rows }))
    } catch (e) { toast('加载章节失败：' + (e as Error).message) }
  }

  async function toggleTextbook(id: string) {
    const nextTb = new Set(selectedTextbooks)
    const nextCh = new Set(selectedChapters)
    if (nextTb.has(id)) {
      nextTb.delete(id)
      chaptersByTb[id]?.forEach((c) => nextCh.delete(c.id))
    } else {
      nextTb.add(id)
      if (chaptersByTb[id]) {
        chaptersByTb[id].forEach((c) => nextCh.add(c.id))
      } else {
        try {
          const rows = await api.get<Chapter[]>(`/api/v1/textbooks/${id}/chapters`)
          setChaptersByTb((prev) => ({ ...prev, [id]: rows }))
          rows.forEach((c) => nextCh.add(c.id))
        } catch (e) {
          toast('加载章节失败：' + (e as Error).message)
        }
      }
    }
    setSelectedTextbooks(nextTb)
    setSelectedChapters(nextCh)
  }

  function toggleTbExpand(id: string) {
    if (expandedTb === id) {
      setExpandedTb(null)
    } else {
      setExpandedTb(id)
      if (!chaptersByTb[id]) {
        void loadChapters(id)
      }
    }
  }

  function toggleChapterSelection(id: string) {
    const next = new Set(selectedChapters)

    // 构建 parent_id -> 子章节ID列表 映射（用于上下级联动）
    const childrenMap = new Map<string, string[]>()
    Object.values(chaptersByTb).forEach((rows) => {
      rows.forEach((c) => {
        if (c.parent_id) {
          const kids = childrenMap.get(c.parent_id) ?? []
          kids.push(c.id)
          childrenMap.set(c.parent_id, kids)
        }
      })
    })

    if (next.has(id)) {
      // 取消勾选：递归移除自身及全部子章节
      const toRemove: string[] = []
      const collectDown = (pid: string) => {
        toRemove.push(pid)
        const kids = childrenMap.get(pid) ?? []
        kids.forEach(collectDown)
      }
      collectDown(id)
      toRemove.forEach((cid) => next.delete(cid))
    } else {
      // 勾选：加入自身，递归加入全部子章节，并向上追溯自动勾选所有父章节
      const collectDown = (pid: string) => {
        next.add(pid)
        const kids = childrenMap.get(pid) ?? []
        kids.forEach(collectDown)
      }
      collectDown(id)
      const findParent = (cid: string): string | null => {
        for (const rows of Object.values(chaptersByTb)) {
          const p = rows.find((c) => c.id === cid)
          if (p) return p.parent_id ?? null
        }
        return null
      }
      let pid = findParent(id)
      while (pid) {
        next.add(pid)
        pid = findParent(pid)
      }
    }
    setSelectedChapters(next)
  }

  function toggleChapterExpand(id: string) {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleType(t: string) {
    setSpec((s) => {
      const types = { ...s.types }
      if (types[t]) delete types[t]
      else types[t] = 2
      return { ...s, types }
    })
  }

  function setTypeCount(t: string, val: number) {
    const n = Math.max(0, val || 0)
    setSpec((s) => ({ ...s, types: { ...s.types, [t]: n } }))
  }

  async function startGenerate() {
    if (!courseId) return toast('请先在左侧选择课程')
    if (selectedChapters.size === 0) return toast('请至少选择一个章节')
    if (!spec.model_id) return toast('请选择生成模型')
    const totalTypes = Object.values(spec.types).filter((n) => n > 0).length
    if (totalTypes === 0) return toast('请至少选择一种题型')

    // 记录生成前已有的草稿，避免误发布其他草稿
    let beforeDraftIds: string[] = []
    try {
      const before = await api.get<Exercise[]>(`/api/v1/exercises?course_id=${courseId}&status=draft`)
      beforeDraftIds = before.map((q) => q.id)
    } catch { /* 忽略 */ }

    setGenerating(true)
    try {
      const task = await api.post<Task>('/api/v1/exercises/generate', {
        course_id: courseId,
        chapter_ids: [...selectedChapters],
        types: spec.types,
        difficulty: spec.difficulty,
        explain: spec.explain,
        answer: spec.answer,
        model_id: spec.model_id,
      })
      toast('出题任务已提交，流式跟踪中…')
      const es = openSSE(`/api/v1/tasks/${task.id}/events`, (ev, data) => {
        if (ev === 'task.done') {
          es.close()
          setGenerating(false)
          handleGenerateDone(beforeDraftIds)
        }
        if (ev === 'task.error') {
          es.close()
          setGenerating(false)
          toast('生成失败：' + (data.error || '未知错误'))
        }
      })
    } catch (e) {
      setGenerating(false)
      toast('提交失败：' + (e as Error).message)
    }
  }

  async function handleGenerateDone(beforeDraftIds: string[]) {
    try {
      const drafts = await api.get<Exercise[]>(`/api/v1/exercises?course_id=${courseId}&status=draft`)
      const newDrafts = drafts.filter((q) => !beforeDraftIds.includes(q.id))
      if (newDrafts.length === 0) return toast('未生成到题目')

      // 全部发布到题库
      for (const q of newDrafts) {
        await api.patch(`/api/v1/exercises/${q.id}`, { status: 'published' })
      }

      const p = await api.post<{ id: string }>('/api/v1/papers', {
        course_id: courseId, title: paperTitle,
        exercise_ids: newDrafts.map((q) => q.id), duration_min: 30, shuffle: true,
      })
      setCreating(false)
      setPaperTitle('')
      openView(p.id)
      toast(`试卷已生成（${newDrafts.length} 题）`)
    } catch (e) {
      setGenerating(false)
      toast('创建试卷失败：' + (e as Error).message)
    }
  }

  async function openView(id: string) {
    setMode('view')
    setDoing(null)
    setShowAnswer(false)
    try {
      const d = await api.get<PaperDetail>(`/api/v1/papers/${id}`)
      setViewing(d)
    } catch (e) { toast('加载试卷失败：' + (e as Error).message); setMode('list') }
  }

  async function delPaper() {
    if (!deleting) return
    try {
      await api.del(`/api/v1/papers/${deleting.id}`)
      setDeleting(null)
      toast('试卷已删除')
      loadPapers()
    } catch (e) { toast('删除失败：' + (e as Error).message) }
  }

  function startQuiz() {
    if (!viewing) return
    startQuizById(viewing.id)
  }

  function startQuizById(id: string) {
    if (loading) return
    setLoading(true)
    ;(async () => {
      try {
        const d = viewing && viewing.id === id
          ? viewing
          : await api.get<PaperDetail>(`/api/v1/papers/${id}`)
        if (!d || d.questions.length === 0) return toast('该试卷暂无题目')
        if (d.id !== id) setViewing(d)
        const att = await api.post<{ id: string; duration_min: number }>(`/api/v1/papers/${id}/attempts`)
        setDoing({
          attemptId: att.id,
          paper: { title: d.title, duration_min: d.duration_min },
          questions: d.questions.map((pq) => ({
            id: pq.id, type: pq.type, stem: pq.stem, options: pq.options,
            answer: pq.answer, explanation: pq.explanation,
            difficulty: pq.difficulty, score: pq.score, order: pq.order, user_answer: null,
          })),
        })
        setMode('doing')
      } catch (e) { toast('开始测验失败：' + (e as Error).message) }
      finally { setLoading(false) }
    })()
  }
}
