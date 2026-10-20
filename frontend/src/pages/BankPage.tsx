import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL, type Exercise } from '../types'
import DoingPanel, { type QItem } from '../components/DoingPanel'

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

interface PracticeOpt {
  count: number
  preferUnanswered: boolean
  includeWrong: boolean
}

export default function BankPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [rows, setRows] = useState<Exercise[]>([])
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [practice, setPractice] = useState<PracticeOpt | null>(null)
  const [deleting, setDeleting] = useState<Exercise | null>(null)
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    stem: '', options: '', answer: '', explanation: '', difficulty: 3, status: 'published',
  })
  const [doing, setDoing] = useState<{
    attemptId: string; questions: QItem[]; paper: { title: string; duration_min: number }
  } | null>(null)

  async function refresh() {
    if (!courseId) { setRows([]); return }
    try {
      setRows(await api.get<Exercise[]>(`/api/v1/exercises?course_id=${courseId}`))
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => { refresh() }, [courseId])

  async function delQuestion() {
    if (!deleting) return
    try {
      await api.del(`/api/v1/exercises/${deleting.id}`)
      setDeleting(null)
      toast('题目已删除')
      refresh()
    } catch (e) { toast('删除失败：' + (e as Error).message) }
  }

  const bankCount = rows.filter((q) => q.status === 'published').length

  // 题型筛选 + 关键词过滤
  const typeCount = new Map<string, number>()
  rows.forEach((q) => typeCount.set(q.type, (typeCount.get(q.type) ?? 0) + 1))
  const typeList = [...typeCount.entries()]
  const kw = keyword.trim().toLowerCase()
  const filtered = rows.filter((q) =>
    (typeFilter === 'all' || q.type === typeFilter) &&
    (statusFilter === 'all' || q.status === statusFilter) &&
    (!kw || q.stem.toLowerCase().includes(kw)))

  function openEdit(q: Exercise) {
    setEditing(q)
    setForm({
      stem: q.stem,
      options: Array.isArray(q.options) ? (q.options as unknown[]).map(String).join('\n') : '',
      answer: q.answer,
      explanation: q.explanation,
      difficulty: q.difficulty,
      status: q.status,
    })
  }

  async function saveEdit() {
    if (!editing) return
    if (!form.stem.trim()) { toast('题干不能为空'); return }
    if (form.status === 'published' && !form.answer.trim()) {
      toast('发布前请先填写参考答案'); return
    }
    setSaving(true)
    try {
      const options = form.options.split('\n').map((s) => s.trim()).filter(Boolean)
      await api.patch(`/api/v1/exercises/${editing.id}`, {
        stem: form.stem.trim(),
        options: options.length ? options : null,
        answer: form.answer,
        explanation: form.explanation,
        difficulty: form.difficulty,
        status: form.status,
      })
      setEditing(null)
      toast('题目已保存')
      refresh()
    } catch (e) { toast('保存失败：' + (e as Error).message) }
    finally { setSaving(false) }
  }

  async function togglePublish(q: Exercise) {
    const next = q.status === 'published' ? 'draft' : 'published'
    if (next === 'published' && !q.answer.trim()) {
      toast('发布前请先填写参考答案')
      openEdit(q)
      return
    }
    try {
      await api.patch(`/api/v1/exercises/${q.id}`, { status: next })
      toast(next === 'published' ? '已发布到题库' : '已撤回为草稿')
      refresh()
    } catch (e) { toast('操作失败：' + (e as Error).message) }
  }

  async function rate(q: Exercise, value: number) {
    const next = q.quality_rating === value ? null : value
    try {
      await api.patch(`/api/v1/exercises/${q.id}`, { quality_rating: next })
      setRows((list) => list.map((x) => (x.id === q.id ? { ...x, quality_rating: next } : x)))
    } catch (e) { toast('标记失败：' + (e as Error).message) }
  }

  async function addWrong(q: Exercise) {
    try {
      await api.post(`/api/v1/courses/${courseId}/wrong-questions`, { question_id: q.id })
      toast('已加入错题本')
    } catch (e) { toast('加入失败：' + (e as Error).message) }
  }

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('home')}>返回首页</button>
      </div>
    )
  }

  if (doing) {
    return (
      <>
        <div className="page-head">
          <button className="btn btn-ghost btn-sm" onClick={() => setDoing(null)}>← 返回题库</button>
          <h1>📝 去练习</h1>
        </div>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <DoingPanel
            go={go} courseId={courseId}
            attemptId={doing.attemptId}
            questions={doing.questions}
            paper={doing.paper}
            onFinish={() => { setDoing(null); go('report') }}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>🗂️ 题库</h1>
        <span className="sub">{rows.length} 题{bankCount !== rows.length ? ` · 已发布 ${bankCount}` : ''}</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={openPractice} disabled={bankCount === 0}>
          去练习
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {practice && (
        <div className="modal-mask" onClick={closePractice}>
          <div className="modal practice-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>去练习 · 随机抽题</h3>
              <button className="btn btn-ghost btn-sm" onClick={closePractice}>关闭</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>题目数量</label>
                <input type="number" min={1} max={bankCount}
                  value={practice.count}
                  onChange={(e) => setPractice({ ...practice, count: Math.min(bankCount, Math.max(1, +e.target.value || 1)) })} />
              </div>
              <div className="field-row" style={{ gap: 10, marginBottom: 0 }}>
                <div className={`chk ${practice.preferUnanswered ? 'checked' : ''}`} onClick={() => setPractice((p) => ({ ...p!, preferUnanswered: !p!.preferUnanswered }))}>
                  <input type="checkbox" checked={practice.preferUnanswered} readOnly />
                  <div className="t">优先未作题目</div>
                </div>
                <div className={`chk ${practice.includeWrong ? 'checked' : ''}`} onClick={() => setPractice((p) => ({ ...p!, includeWrong: !p!.includeWrong }))}>
                  <input type="checkbox" checked={practice.includeWrong} readOnly />
                  <div className="t">包含错题本中的题</div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="hint">可用已发布题目 {bankCount} 题</span>
              <button className="btn btn-ghost" onClick={closePractice}>取消</button>
              <button className="btn btn-primary" onClick={startPractice}>开始练习</button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <div className="modal-mask" onClick={() => setEditing(null)}>
          <div className="modal" style={{ width: 660, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>编辑题目</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>关闭</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>题干</label>
                <textarea rows={3} value={form.stem}
                  onChange={(e) => setForm({ ...form, stem: e.target.value })} />
              </div>
              <div className="field">
                <label>选项（每行一个，留空表示主观题 / 判断题）</label>
                <textarea rows={4} value={form.options} placeholder={'A. 选项一\nB. 选项二\nC. 选项三\nD. 选项四'}
                  onChange={(e) => setForm({ ...form, options: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field" style={{ flex: 1 }}>
                  <label>参考答案</label>
                  <input value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
                </div>
                <div className="field" style={{ width: 130 }}>
                  <label>难度</label>
                  <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: +e.target.value })}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
                  </select>
                </div>
                <div className="field" style={{ width: 130 }}>
                  <label>状态</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="published">已发布</option>
                    <option value="draft">草稿</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>解析</label>
                <textarea rows={3} value={form.explanation}
                  onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
              </div>
            </div>
            <div className="modal-foot">
              <span className="hint">保存后立即生效；草稿不会进入练习抽题</span>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="modal-mask" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除题目</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
              确认删除题目「{deleting.stem.slice(0, 60)}{deleting.stem.length > 60 ? '…' : ''}」？<br />
              该题将从题库、引用它的试卷及错题本中一并移除，此操作不可恢复。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDeleting(null)}>取消</button>
              <button className="btn btn-danger" onClick={delQuestion}>删除</button>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && !error ? (
        <div className="card empty-card">
          <div className="ec-ico">🗂️</div>
          <div className="ec-t">题库暂无题目</div>
          <div className="ec-s">新建试卷时 AI 会把生成的题目发布到题库；也可在「教材」页按章节生成</div>
          <button className="btn btn-primary" onClick={() => go('paper')}>去新建试卷</button>
        </div>
      ) : (
        <>
          <div className="bank-toolbar">
            <div className="fchips">
              <button className={`fchip ${typeFilter === 'all' ? 'on' : ''}`} onClick={() => setTypeFilter('all')}>
                全部<b>{rows.length}</b>
              </button>
              {typeList.map(([t, n]) => (
                <button key={t} className={`fchip ${typeFilter === t ? 'on' : ''}`} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}>
                  {QTYPE_LABEL[t] || t}<b>{n}</b>
                </button>
              ))}
            </div>
            <div className="fchips">
              <button className={`fchip ${statusFilter === 'all' ? 'on' : ''}`} onClick={() => setStatusFilter('all')}>全部状态</button>
              <button className={`fchip ${statusFilter === 'published' ? 'on' : ''}`} onClick={() => setStatusFilter('published')}>
                已发布<b>{bankCount}</b>
              </button>
              <button className={`fchip ${statusFilter === 'draft' ? 'on' : ''}`} onClick={() => setStatusFilter('draft')}>
                草稿<b>{rows.length - bankCount}</b>
              </button>
            </div>
            <div className="bank-search">
              <input placeholder="搜索题干…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
          </div>

          <div className="card bank-panel">
            <table className="bank-table">
              <thead>
                <tr>
                  <th style={{ width: 78 }}>题型</th>
                  <th>题干</th>
                  <th style={{ width: 108 }}>难度</th>
                  <th style={{ width: 82 }}>质量</th>
                  <th style={{ width: 84 }}>状态</th>
                  <th style={{ width: 240, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id}>
                    <td><span className={`qtype ${q.type}`}>{QTYPE_LABEL[q.type] || q.type}</span></td>
                    <td><div className="bank-stem" title={q.stem}>{q.stem}</div></td>
                    <td className="stars">{'★'.repeat(q.difficulty)}{'☆'.repeat(5 - q.difficulty)}</td>
                    <td className="bank-ops" style={{ textAlign: 'left' }}>
                      <button className="btn btn-sm btn-ghost" title="标记高质量"
                        style={{ opacity: q.quality_rating === 5 ? 1 : 0.45 }}
                        onClick={() => rate(q, 5)}>👍</button>
                      <button className="btn btn-sm btn-ghost" title="标记需改进"
                        style={{ opacity: q.quality_rating === 1 ? 1 : 0.45 }}
                        onClick={() => rate(q, 1)}>👎</button>
                    </td>
                    <td>
                      {q.status === 'published'
                        ? <span className="tag ok">已发布</span>
                        : <span className="tag">草稿</span>}
                    </td>
                    <td className="bank-ops">
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(q)}>编辑</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => togglePublish(q)}>
                        {q.status === 'published' ? '撤回' : '发布'}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => addWrong(q)}>错题</button>
                      <button className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => setDeleting(q)}>删除</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="empty" style={{ padding: 40 }}>无匹配题目，换个关键词或筛选条件试试</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )

  function openPractice() {
    setPractice({ count: Math.min(10, bankCount), preferUnanswered: true, includeWrong: false })
  }
  function closePractice() { setPractice(null) }

  async function startPractice() {
    if (!practice || bankCount === 0) return
    try {
      const r = await api.post<{
        attempt_id: string; paper_id: string;
        questions: Array<{ id: string; type: string; stem: string; options: unknown[] | null; difficulty: number; order: number; score: number }>
      }>(`/api/v1/courses/${courseId}/practice`, {
        count: practice.count,
        prefer_unanswered: practice.preferUnanswered,
        include_wrong: practice.includeWrong,
      })
      setPractice(null)
      setDoing({
        attemptId: r.attempt_id,
        paper: { title: '练习', duration_min: 0 },
        questions: r.questions.map((qq, i) => ({
          ...qq, user_answer: null, order: qq.order ?? i + 1,
        })),
      })
    } catch (e) { toast('抽题失败：' + (e as Error).message) }
  }
}
