import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { CourseContext, ToastContext } from '../App'
import type { NavTarget } from '../App'
import type { Task, Textbook } from '../types'

interface Props {
  go: (v: NavTarget) => void
}

export default function HomePage({ go }: Props) {
  const toast = useContext(ToastContext)
  const { courses, course, setCourseId } = useContext(CourseContext)
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [usage, setUsage] = useState<{ tokens_in: number; tokens_out: number; tasks: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [t, j, u] = await Promise.all([
          api.get<Textbook[]>('/api/v1/textbooks'),
          api.get<Task[]>('/api/v1/tasks?limit=20'),
          api.get<{ tokens_in: number; tokens_out: number; tasks: number }>('/api/v1/usage/summary'),
        ])
        setTextbooks(t)
        setTasks(j)
        setUsage(u)
      } catch (e) {
        setError(String(e))
        toast('无法连接本地服务：' + String(e))
      }
    })()
  }, [toast])

  const recentCourses = courses.slice(0, 4)

  function enterCourse(id: string) {
    setCourseId(id)
    go('workspace')
  }

  return (
    <>
      <div className="page-head">
        <h1>下午好 👋</h1>
        <span className="sub">本地优先 · 数据留在本机</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => go('courses')}>📚 进入我的课程</button>
      </div>
      {error && <div className="error-box">无法连接 sidecar：{error}</div>}
      <div className="stat-grid">
        <div className="card stat"><div className="num">{courses.length}</div><div className="lbl">课程</div></div>
        <div className="card stat"><div className="num">{textbooks.length}</div><div className="lbl">教材</div></div>
        <div className="card stat"><div className="num">{textbooks.reduce((s, t) => s + t.word_count, 0).toLocaleString()}</div><div className="lbl">总字数</div></div>
        <div className="card stat"><div className="num">{tasks.filter((t) => t.status === 'running').length}</div><div className="lbl">运行中任务</div></div>
        <div className="card stat">
          <div className="num">{usage ? (usage.tokens_in + usage.tokens_out).toLocaleString() : '—'}</div>
          <div className="lbl">本月 token · {usage?.tasks ?? 0} 个任务</div>
        </div>
      </div>
      <div className="page-head" style={{ marginTop: 22 }}>
        <h1 style={{ fontSize: 16 }}>最近课程</h1>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => go('courses')}>查看全部 →</button>
      </div>
      <div className="dash-grid">
        {recentCourses.map((c) => (
          <div className="card course-card" key={c.id} onClick={() => enterCourse(c.id)}>
            <h3>📘 {c.name}</h3>
            <div className="meta">
              {c.subject && <span>{c.subject}</span>}
              {c.term && <span>{c.term}</span>}
              <span>{textbooks.filter((t) => t.course_id === c.id).length} 本教材</span>
            </div>
            <div className="divider" />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="tag accent">{c.status === 'active' ? '在用' : c.status}</span>
              <span className="tag">创建于 {c.created_at.slice(0, 10)}</span>
            </div>
          </div>
        ))}
        {courses.length === 0 && !error && (
          <div className="card course-card" onClick={() => go('courses')} style={{ cursor: 'pointer' }}>
            <h3 style={{ color: 'var(--faint)' }}>＋ 新建课程</h3>
            <div className="meta">创建课程、导入教材、开始学习</div>
          </div>
        )}
      </div>
      {course && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>📘</span>
            <div>
              <div style={{ fontWeight: 600 }}>当前课程：{course.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                点击上方课程卡片或侧边栏「我的课程」进入工作区
              </div>
            </div>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => go('workspace')}>进入工作区 →</button>
          </div>
        </div>
      )}
    </>
  )
}
