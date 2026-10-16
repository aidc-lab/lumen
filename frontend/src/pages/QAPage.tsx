import { useContext, useEffect, useRef, useState } from 'react'
import { api, openPostSSE } from '../api'
import { ToastContext } from '../App'
import type { Chapter, Citation, Session as SessionT, Message, Textbook } from '../types'

interface DraftMsg {
  role: 'user' | 'assistant'
  text: string
  citations: Citation[]
  pendingCite: boolean
  refs?: string[] // 该条消息发送时的 @ 引用
}

interface RefItem {
  id: string
  textbook: string
  chapter: string
  whole: boolean // true 表示整本教材
  ids: string[] // 实际发送的章节 id 列表（整本教材时为全部章节）
}

export default function QAPage({ courseId }: { courseId: string }) {
  const toast = useContext(ToastContext)
  const [sessions, setSessions] = useState<SessionT[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<DraftMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelId, setModelId] = useState<string | null>(null)
  const [refs, setRefs] = useState<RefItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [textbooks, setTextbooks] = useState<{ id: string; title: string; chapters: Chapter[] }[]>([])
  const chatRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 输入框随内容自动撑高
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [input])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [msgs])

  // 加载会话、模型与教材目录（用于 @ 引用）
  useEffect(() => {
    if (!courseId) { setSessions([]); setMsgs([]); setSessionId(null); return }
    ;(async () => {
      try {
        const [list, modelsRes, texts] = await Promise.all([
          api.get<SessionT[]>(`/api/v1/sessions?course_id=${courseId}`),
          api.get<{ id: string; name: string; capabilities: string[] }[]>('/api/v1/models'),
          api.get<Textbook[]>(`/api/v1/textbooks?course_id=${courseId}`),
        ])
        setSessions(list)
        setModels(modelsRes.filter((m) => m.capabilities.includes('text')))
        if (modelsRes.length) setModelId(modelsRes[0].id)
        const loaded = await Promise.all(
          texts.map(async (t) => ({
            ...t,
            chapters: await api.get<Chapter[]>(`/api/v1/textbooks/${t.id}/chapters`),
          })))
        setTextbooks(loaded)
        if (list[0]) await openSession(list[0].id)
      } catch (e) { toast('加载失败：' + (e as Error).message) }
    })().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, toast])

  async function openSession(id: string) {
    setSessionId(id)
    const history = await api.get<Message[]>(`/api/v1/sessions/${id}/messages`)
    setMsgs(history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      text: m.content,
      citations: m.citations?.list ?? [],
      pendingCite: false,
      refs: (m.citations?.refs as string[] | undefined) ?? [],
    })))
  }

  async function newSession() {
    if (!courseId) return
    const s = await api.post<SessionT>('/api/v1/sessions', {
      title: `会话 ${sessions.length + 1}`, course_id: courseId, scope: {}, mode: 'direct',
    })
    setSessionId(s.id)
    setMsgs([])
    setSessions(await api.get<SessionT[]>(`/api/v1/sessions?course_id=${courseId}`))
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming || !sessionId) return
    closePicker()
    const refLabels = refs.map((r) => (r.whole ? `《${r.textbook}》(全本)` : `《${r.textbook}》${r.chapter}`))
    const chapter_ids = refs.flatMap((r) => r.ids)
    setInput('')
    setRefs([]) // 发送后清空引用
    if (taRef.current) taRef.current.style.height = 'auto'
    setMsgs((m) => [...m, { role: 'user', text, citations: [], pendingCite: false, refs: refLabels }])
    setStreaming(true)
    setMsgs((m) => [...m, { role: 'assistant', text: '', citations: [], pendingCite: false }])

    let handle: { close: () => void } | null = null
    let finished = false
    const onEv = (ev: string, data: any) => {
      if (ev === 'delta') {
        setMsgs((m) => {
          const copy = [...m]
          const last = { ...copy[copy.length - 1] }
          last.text += data
          copy[copy.length - 1] = last
          return copy
        })
      }
      if (ev === 'citation') {
        setMsgs((m) => {
          const copy = [...m]
          const last = { ...copy[copy.length - 1] }
          if (!last.citations.some((c) => c.chunk_id === data.chunk_id)) {
            last.citations = [...last.citations, data as Citation]
          }
          copy[copy.length - 1] = last
          return copy
        })
      }
      if (ev === 'done' || ev === 'error') {
        finished = true
        handle?.close()
        setStreaming(false)
        if (ev === 'error') toast('生成出错：' + (data?.message || ''))
      }
    }

    try {
      handle = await openPostSSE(
        `/api/v1/sessions/${sessionId}/messages`,
        { content: text, model_id: modelId ?? undefined, chapter_ids: chapter_ids.length ? chapter_ids : undefined },
        onEv,
        () => setStreaming(false),
      )
      if (finished) handle.close()
    } catch (e) {
      setStreaming(false)
      toast('发送失败：' + (e as Error).message)
    }
  }

  // ---------- @ 引用选择器（输入框内联面板） ----------
  const [pickerTyped, setPickerTyped] = useState(false)
  const [hi, setHi] = useState(0) // 上下键高亮项
  const panelRef = useRef<HTMLDivElement>(null)
  const closePicker = () => { setPickerOpen(false); setPickerQuery(''); setPickerTyped(false); setHi(0) }
  const togglePicker = () => {
    if (pickerOpen) closePicker()
    else { setPickerOpen(true); setPickerQuery(''); setPickerTyped(false); setHi(0) }
  }
  // 输入中出现 @xxx 时弹出引用列表
  const onInputChange = (v: string) => {
    setInput(v)
    const m = /@([^\s@]*)$/.exec(v)
    if (m) { setPickerOpen(true); setPickerQuery(m[1] ?? ''); setPickerTyped(true); setHi(0) }
    else if (pickerTyped) closePicker()
  }
  const addRef = (textbook: string, chapter: string, id: string, whole: boolean, ids: string[] = []) => {
    if (!refs.some((r) => r.id === id)) setRefs([...refs, { id, textbook, chapter, whole, ids: ids.length ? ids : [id] }])
    if (pickerTyped) setInput((prev) => prev.replace(/@([^\s@]*)$/, '').replace(/\s+$/, ''))
    closePicker()
  }
  const removeRef = (id: string) => setRefs(refs.filter((r) => r.id !== id))

  const filteredBooks = textbooks.map((tb) => ({
    ...tb,
    chapters: tb.chapters.filter((c) =>
      c.title.includes(pickerQuery) || tb.title.includes(pickerQuery) || pickerQuery === ''
    ),
  })).filter((tb) => tb.chapters.length > 0 || tb.title.includes(pickerQuery))

  // 扁平化列表：渲染与键盘选择共用
  const entries: { key: string; name: string; desc: string; pick: () => void }[] = []
  filteredBooks.forEach((tb) => {
    entries.push({
      key: `tb:${tb.id}`, name: `《${tb.title}》 整本教材`,
      desc: `共 ${tb.chapters.length} 个章节 · 引用全书内容`,
      pick: () => addRef(tb.title, tb.title, `tb:${tb.id}`, true, tb.chapters.map((c) => c.id)),
    })
    tb.chapters.forEach((c) => entries.push({
      key: c.id, name: c.title,
      desc: `《${tb.title}》${c.page_start != null ? ` · p.${c.page_start}` : ''}`,
      pick: () => addRef(tb.title, c.title, c.id, false),
    }))
  })
  const act = entries.length ? Math.min(hi, entries.length - 1) : 0

  // 高亮项滚动到可视区
  useEffect(() => {
    if (!pickerOpen) return
    panelRef.current?.querySelector(`[data-idx="${act}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [act, pickerOpen])

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (pickerOpen && entries.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (Math.min(h, entries.length - 1) + 1) % entries.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => { const cur = Math.min(h, entries.length - 1); return (cur - 1 + entries.length) % entries.length }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); entries[act].pick(); return }
      if (e.key === 'Escape') { e.preventDefault(); closePicker(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  if (!courseId) {
    return <div className="card empty">请在左侧「我的课程」中选择课程</div>
  }

  return (
    <div className="qa-page">
      <div className="page-head">
        <h1>💬 答疑</h1>
        <span className="sub">AI 教师 · 基于教材内容回答，引用可追溯</span>
        <div className="spacer" />
      </div>
      <div className="qa-layout">
        {/* 左侧：仅历史会话 + 新建会话 */}
        <div className="qa-side">
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={newSession} style={{ flex: 1 }}>＋ 新会话</button>
          </div>
          <div className="side-label">历史会话</div>
          <div className="sessions-list">
            {sessions.map((s) => (
              <div key={s.id}
                className={`session-item ${sessionId === s.id ? 'active' : ''}`}
                onClick={() => openSession(s.id)}>
                <span className="s-ico">💬</span>
                <div className="s-title">{s.title}</div>
                <div className="s-time">{new Date(s.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
            {sessions.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: 8 }}>暂无会话</div>}
          </div>
        </div>

        {/* 右侧：对话 */}
        <div className="qa-main">
          <div className="chat" ref={chatRef}>
            {msgs.length === 0 && !streaming && (
              <div className="qa-empty">
                <div className="qa-empty-ico">💬</div>
                <div className="qa-empty-t">向 AI 教师提问</div>
                <div className="qa-empty-s">回答基于已导入的教材内容，结论附引用出处可回溯原文；输入 @ 可限定检索的章节或整本教材。</div>
                <div className="qa-empty-qs">
                  {['本章的重点内容是什么？', '请讲解关键概念并举例', '出几道自测题考考我'].map((q) => (
                    <button key={q} className="qa-q" onClick={() => { setInput(q); taRef.current?.focus() }}>{q}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="avatar">{m.role === 'user' ? '学' : '师'}</div>
                <div className="body">
                  <div className="name">{m.role === 'user' ? '学生' : 'AI 教师'}</div>
                  <div className="bubble">
                    {m.role === 'user' && !!m.refs?.length && (
                      <div className="msg-refs">
                        {m.refs.map((r, k) => <span key={k} className="ref-chip">@ {r}</span>)}
                      </div>
                    )}
                    {m.text || (m.role === 'assistant' && <span className="typing"><span /><span /><span /></span>)}
                    {m.citations.map((c, j) => (
                      <span key={j} className="cite">
                        📎 {c.textbook} {c.chapter}{c.page_no != null ? ` p.${c.page_no}` : ''} ¶{c.para_no}
                        <span className="pop">
                          <div className="src">原文片段 · {c.textbook} · {c.chapter}{c.page_no != null ? ` p.${c.page_no}` : ''} ¶{c.para_no}</div>
                          {c.snippet}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="composer-wrap">
            {pickerOpen && (
              <div className="ref-panel" ref={panelRef}>
                <div className="ref-panel-head">@ 引用教材章节或整本教材 · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
                <div className="ref-panel-list">
                  {entries.map((it, i) => (
                    <div key={it.key} data-idx={i}
                      className={`ref-row${i === act ? ' hi' : ''}`}
                      onMouseEnter={() => setHi(i)}
                      onClick={it.pick}>
                      <span className="ref-at">@</span>
                      <div className="ref-txt">
                        <div className="ref-name">{it.name}</div>
                        <div className="ref-desc">{it.desc}</div>
                      </div>
                    </div>
                  ))}
                  {entries.length === 0 && <div className="ref-empty">无匹配教材或章节</div>}
                </div>
              </div>
            )}

            {refs.length > 0 && (
              <div className="ref-chips">
                {refs.map((r) => (
                  <span key={r.id} className="ref-chip">
                    @ {r.whole ? `《${r.textbook}》(全本)` : `《${r.textbook}》${r.chapter}`}
                    <span onClick={() => removeRef(r.id)} style={{ marginLeft: 5, cursor: 'pointer', color: 'var(--danger)' }}>×</span>
                  </span>
                ))}
                <button className="btn btn-sm btn-ghost" onClick={() => setRefs([])} style={{ fontSize: 11 }}>清空</button>
              </div>
            )}

            <textarea rows={2} ref={taRef} placeholder="向 AI 教师提问，输入 @ 引用教材章节或整本教材…"
              value={input} onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onInputKeyDown} />

            <div className="composer-bar">
              <button className="composer-plus" title="引用教材章节 / 整本教材" onClick={togglePicker} disabled={streaming}>＋</button>
              <select
                className="composer-model"
                value={modelId || ''}
                onChange={(e) => setModelId(e.target.value || null)}
                disabled={streaming}
              >
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
              <button className="composer-send" onClick={send} disabled={streaming || !input.trim()} title="发送">↑</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
