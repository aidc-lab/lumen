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
  const [editing, setEditing] = useState<Course | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [term, setTerm] = useState('')
  const [description, setDescription] = useState('')
  const [deleting, setDeleting] = useState<Course | null>(null)

  useEffect(() => {
    api.get<Textbook[]>('/api/v1/textbooks')
      .then(setTextbooks)
      .catch(() => {})
  }, [])

  function openCreate() {
    setEditing(null)
    setName('')
    setSubject('')
    setTerm('')
    setDescription('')
    setCreating(true)
  }

  function openEdit(c: Course) {
    setEditing(c)
    setName(c.name)
    setSubject(c.subject || '')
    setTerm(c.term || '')
    setDescription(c.description || '')
    setCreating(true)
  }

  async function saveCourse() {
    const n = name.trim()
    if (!n) return
    const body = {
      name: n, subject: subject.trim(), term: term.trim(), description: description.trim(),
    }
    try {
      if (editing) {
        await api.patch<Course>(`/api/v1/courses/${editing.id}`, body)
        toast('课程信息已更新')
      } else {
        await api.post<Course>('/api/v1/courses', body)
        toast('课程已创建 —— 点击卡片进入工作区')
      }
      await refreshCourses()
      setCreating(false)
      setEditing(null)
    } catch (e) { toast((editing ? '保存失败：' : '创建失败：') + (e as Error).message) }
  }

  async function toggleArchive(c: Course) {
    const next = c.status === 'archived' ? 'active' : 'archived'
    try {
      await api.patch(`/api/v1/courses/${c.id}`, { status: next })
      await refreshCourses()
      toast(next === 'archived' ? '课程已归档' : '课程已恢复')
    } catch (e) { toast('操作失败：' + (e as Error).message) }
  }

  async function deleteCourse() {
    if (!deleting) return
    try {
      await api.del(`/api/v1/courses/${deleting.id}`)
      if (localStorage.getItem('lumen-course') === deleting.id) setCourseId(null)
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
        <button className="btn btn-primary" onClick={openCreate}>＋ 新建课程</button>
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
              <span className={`tag ${c.status === 'active' ? 'accent' : ''}`}>
                {c.status === 'active' ? '在用' : c.status === 'archived' ? '已归档' : c.status}
              </span>
              <span className="tag">创建于 {c.created_at.slice(0, 10)}</span>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm"
                onClick={(e) => { e.stopPropagation(); openEdit(c) }}>编辑</button>
              <button className="btn btn-ghost btn-sm"
                onClick={(e) => { e.stopPropagation(); toggleArchive(c) }}>
                {c.status === 'archived' ? '恢复' : '归档'}
              </button>
              <button
                className="btn btn-ghost btn-sm btn-danger"
                onClick={(e) => { e.stopPropagation(); setDeleting(c) }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
        <div className="card course-card" onClick={openCreate} style={{ cursor: 'pointer' }}>
          <h3 style={{ color: 'var(--faint)' }}>＋ 新建课程</h3>
          <div className="meta">创建课程、导入教材、设置教学目标</div>
        </div>
      </div>
      {creating && (
        <div className="modal-mask" onClick={() => { setCreating(false); setEditing(null) }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? '编辑课程' : '新建课程'}</h3>
            <div className="field">
              <label>课程名称 *</label>
              <input autoFocus placeholder="如：高等数学（上）" value={name}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field-row">
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
            </div>
            <div className="field">
              <label>课程简介（可选）</label>
              <textarea rows={3} placeholder="学习目标、使用说明…" value={description}
                onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => { setCreating(false); setEditing(null) }}>取消</button>
              <button className="btn btn-primary" onClick={saveCourse}
                disabled={!name.trim()}>{editing ? '保存修改' : '创建'}</button>
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
