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
  const [practice, setPractice] = useState<PracticeOpt | null>(null)
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

  const bankCount = rows.filter((q) => q.status === 'published').length

  // 题型筛选 + 关键词过滤
  const typeCount = new Map<string, number>()
  rows.forEach((q) => typeCount.set(q.type, (typeCount.get(q.type) ?? 0) + 1))
  const typeList = [...typeCount.entries()]
  const kw = keyword.trim().toLowerCase()
  const filtered = rows.filter((q) =>
    (typeFilter === 'all' || q.type === typeFilter) &&
    (!kw || q.stem.toLowerCase().includes(kw)))

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
                  <th style={{ width: 84 }}>状态</th>
                  <th style={{ width: 132, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id}>
                    <td><span className={`qtype ${q.type}`}>{QTYPE_LABEL[q.type] || q.type}</span></td>
                    <td><div className="bank-stem" title={q.stem}>{q.stem}</div></td>
                    <td className="stars">{'★'.repeat(q.difficulty)}{'☆'.repeat(5 - q.difficulty)}</td>
                    <td>
                      {q.status === 'published'
                        ? <span className="tag ok">已发布</span>
                        : <span className="tag">草稿</span>}
                    </td>
                    <td className="bank-ops">
                      <button className="btn btn-sm btn-ghost" onClick={() => toast('编辑器为 P1 能力')}>编辑</button>
                      <button className="btn btn-sm btn-ghost btn-danger"
                        onClick={async () => {
                          if (window.confirm('确定删除此题？')) {
                            await api.del(`/api/v1/exercises/${q.id}`)
                            toast('已删除')
                            refresh()
                          }
                        }}>删除</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="empty" style={{ padding: 40 }}>无匹配题目，换个关键词或筛选条件试试</td></tr>
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
