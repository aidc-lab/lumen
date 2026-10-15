import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL, type Exercise } from '../types'

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

export default function BankPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [rows, setRows] = useState<Exercise[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    if (!courseId) { setRows([]); return }
    try {
      const q = [`course_id=${courseId}`]
      if (status) q.push(`status=${status}`)
      setRows(await api.get<Exercise[]>(`/api/v1/exercises?${q.join('&')}`))
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => { refresh() }, [status, courseId])

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('home')}>返回首页</button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>🗂️ 草稿箱 / 题库</h1>
        <span className="sub">{rows.length} 题</span>
        <div className="spacer" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>
        <button className="btn btn-sm" onClick={() => go('wizard')}>＋ 生成新题</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr><th>题型</th><th>题干</th><th>难度</th><th>状态</th><th>质量</th><th>操作</th></tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td><span className={`qtype ${q.type}`}>{QTYPE_LABEL[q.type] || q.type}</span></td>
                <td style={{ maxWidth: 380 }}>{q.stem}</td>
                <td className="stars">{'★'.repeat(q.difficulty)}{'☆'.repeat(5 - q.difficulty)}</td>
                <td>{q.status === 'draft' ? <span className="tag warn">草稿</span> : q.status === 'published' ? <span className="tag ok">已发布</span> : <span className="tag">{q.status}</span>}</td>
                <td>
                  {q.quality_rating
                    ? (q.quality_rating > 0 ? '👍' : '👎')
                    : <>
                      <button className="btn btn-ghost btn-sm" onClick={async () => { await api.patch(`/api/v1/exercises/${q.id}`, { quality_rating: 1 }); refresh() }}>👍</button>
                      <button className="btn btn-ghost btn-sm" onClick={async () => { await api.patch(`/api/v1/exercises/${q.id}`, { quality_rating: -1 }); refresh() }}>👎</button>
                    </>}
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => toast('编辑器为 P1 能力')}>编辑</button>
                  <button className="btn btn-sm btn-ghost btn-danger"
                    onClick={async () => { await api.del(`/api/v1/exercises/${q.id}`); refresh(); toast('已删除') }}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && <div className="empty">暂无题目 —— 通过出题向导生成</div>}
      </div>
    </>
  )
}
