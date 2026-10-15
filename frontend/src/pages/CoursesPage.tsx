import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { CourseContext, ToastContext } from '../App'
import type { NavTarget } from '../App'
import type { Course, Textbook } from '../types'

interface Props {
  go: (v: NavTarget) => void
}

export default function CoursesPage({ go }: Props) {
  const toast = useContext(ToastContext)
  const { courses, setCourseId, refreshCourses } = useContext(CourseContext)
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState('')
  const [deleting, setDeleting] = useState<Course | null>(null)

  useEffect(() => {
    api.get<Textbook[]>('/api/v1/textbooks')
      .then(setTextbooks)
      .catch(() => {})
  }, [])

  async function createCourse() {
    const n = name.trim()
    if (!n) return
    try {
      await api.post<Course>('/api/v1/courses', {
        name: n, subject: subject.trim(), term: term.trim(),
      })
      await refreshCourses()
      setCreating(false)
      setName('')
      setSubject('')
      setTerm('')
      toast('课程已创建 —— 点击卡片进入工作区')
    } catch (e) { toast('创建失败：' + (e as Error).message) }
  }

  async function deleteCourse() {
    if (!deleting) return
    try {
      await api.del(`/api/v1/courses/${deleting.id}`)
      await refreshCourses()
      setDeleting(null)
      toast('课程已删除')
    } catch (e) { toast('删除失败：' + (e as Error).message) }
  }

  function enterCourse(c: Course) {
    setCourseId(c.id)
    go('workspace')
  }

  return (
    <>
      <div className="page-head">
        <h1>📚 我的课程</h1>
        <span className="sub">{courses.length} 个课程</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>＋ 新建课程</button>
      </div>
      <div className="dash-grid">
        {courses.map((c) => (
          <div
            className="card course-card"
            key={c.id}
            onClick={() => enterCourse(c)}
            style={{ cursor: 'pointer' }}
          >
            <h3>📘 {c.name}</h3>
            <div className="meta">
              {c.subject && <span>{c.subject}</span>}
              {c.term && <span>{c.term}</span>}
              <span>{textbooks.filter((t) => t.course_id === c.id).length} 本教材</span>
            </div>
            <div className="divider" />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="tag accent">{c.status === 'active' ? '在用' : c.status}</span>
              <span className="tag">创建于 {c.created_at.slice(0, 10)}</span>
              <div className="spacer" />
              <button
                className="btn btn-ghost btn-sm btn-danger"
                onClick={(e) => { e.stopPropagation(); setDeleting(c) }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        <div className="card course-card" onClick={() => setCreating(true)} style={{ cursor: 'pointer' }}>
          <h3 style={{ color: 'var(--faint)' }}>＋ 新建课程</h3>
          <div className="meta">创建课程、导入教材、设置教学目标</div>
        </div>
      </div>
      {creating && (
        <div className="modal-mask" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>新建课程</h3>
            <div className="field">
              <label>课程名称 *</label>
              <input autoFocus placeholder="如：高等数学（上）" value={name}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>学科（可选）</label>
              <input placeholder="如：数学" value={subject}
                onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="field">
              <label>学期（可选）</label>
              <input placeholder="如：2026 秋" value={term}
                onChange={(e) => setTerm(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setCreating(false)}>取消</button>
              <button className="btn btn-primary" onClick={createCourse}
                disabled={!name.trim()}>创建</button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="modal-mask" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除课程</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
              确认删除课程「{deleting.name}」？<br />
              其下所有教材、章节、题目、试卷、会话将一并删除，此操作不可恢复。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setDeleting(null)}>取消</button>
              <button className="btn btn-danger" onClick={deleteCourse}>删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
