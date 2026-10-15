import { useContext, useEffect, useRef, useState } from 'react'
import { api, openSSE } from '../api'
import { ToastContext } from '../App'
import type { Chapter, Citation, Session as SessionT, Message, Textbook } from '../types'

interface DraftMsg {
  role: 'user' | 'assistant'
  text: string
  citations: Citation[]
  pendingCite: boolean
}

interface Props {
  courseId: string
}

export default function QAPage({ courseId }: Props) {
  const toast = useContext(ToastContext)
  const [sessions, setSessions] = useState<SessionT[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<DraftMsg[]>([])
  const [input, setInput] = useState('')
  const [scope, setScope] = useState('all')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [mode, setMode] = useState('direct')
  const [streaming, setStreaming] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  // 课程变化：重置会话并加载该课程的章节（检索范围）
  useEffect(() => {
    if (!courseId) { setSessions([]); setMsgs([]); setSessionId(null); return }
    setScope('all')
    ;(async () => {
      const [list, texts] = await Promise.all([
        api.get<SessionT[]>(`/api/v1/sessions?course_id=${courseId}`),
        api.get<Textbook[]>(`/api/v1/textbooks?course_id=${courseId}`),
      ])
      setSessions(list)
      if (list[0]) await openSession(list[0].id)
      else {
        const s = await api.post<SessionT>('/api/v1/sessions', {
          title: '新会话', course_id: courseId, scope: {}, mode,
        })
        setSessionId(s.id)
        setMsgs([])
      }
      // 章节树（用于检索范围选择）
      const chapterLists = await Promise.all(
        texts.map((t) => api.get<Chapter[]>(`/api/v1/textbooks/${t.id}/chapters`))
      )
      setChapters(chapterLists.flat())
    })().catch((e) => toast('加载失败：' + e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [msgs])

  async function openSession(id: string) {
    setSessionId(id)
    const history = await api.get<Message[]>(`/api/v1/sessions/${id}/messages`)
    setMsgs(history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      text: m.content,
      citations: m.citations?.list ?? [],
      pendingCite: false,
    })))
  }

  async function newSession() {
    if (!courseId) return
    const s = await api.post<SessionT>('/api/v1/sessions', {
      title: `会话 ${sessions.length + 1}`, course_id: courseId, scope: {}, mode,
    })
    setSessionId(s.id)
    setMsgs([])
    setSessions(await api.get<SessionT[]>(`/api/v1/sessions?course_id=${courseId}`))
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming || !sessionId) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text, citations: [], pendingCite: false }])
    setStreaming(true)
    setMsgs((m) => [...m, { role: 'assistant', text: '', citations: [], pendingCite: false }])
    // 更新会话范围与模式
    await api.patch(`/api/v1/sessions/${sessionId}`, { scope: { chapter_ids: scope === 'all' ? [] : [scope] }, mode }).catch(() => {})

    const es = openSSE(
      `/api/v1/sessions/${sessionId}/messages`,
      (ev, data) => {
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
          es.close()
          setStreaming(false)
          if (ev === 'error') toast('生成出错：' + (data?.message || ''))
        }
      },
      () => setStreaming(false)
    )
  }

  if (!courseId) {
    return <div className="card empty">请在左侧「我的课程」中选择课程</div>
  }

  return (
    <>
      <div className="page-head">
        <h1>💬 答疑（AI 教师）</h1>
        <span className="sub">强制 RAG：答案必带教材引用</span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={newSession}>＋ 新会话</button>
      </div>
      <div className="qa-layout">
        <div className="card qa-side">
          <div className="field">
            <label>检索范围</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">全课程（全部教材）</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>答疑模式</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="direct">直接给答案</option>
              <option value="socratic">苏格拉底式引导（先提示）</option>
              <option value="review">批改学生思路</option>
            </select>
          </div>
          <div className="field">
            <label>历史会话</label>
            {sessions.map((s) => (
              <div key={s.id} className="tree-item" style={{ width: '100%' }} onClick={() => openSession(s.id)}>
                <span style={{ width: 14 }}>💬</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            💡 引用卡片悬停可预览原文片段；教材未覆盖的内容会明确声明。
          </div>
        </div>
        <div className="card qa-main">
          <div className="chat" ref={chatRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="avatar">{m.role === 'user' ? '学' : '师'}</div>
                <div className="body">
                  <div className="name">
                    {m.role === 'user' ? '学生' : `AI 教师 · ${{ direct: '直接给答案', socratic: '苏格拉底式引导', review: '批改思路' }[mode]}`}
                  </div>
                  <div className="bubble">
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
          <div className="composer">
            <textarea rows={2} placeholder="向 AI 教师提问，答案将基于所选范围的教材内容…"
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button className="btn btn-primary" onClick={send} disabled={streaming}>发送</button>
          </div>
        </div>
      </div>
    </>
  )
}
