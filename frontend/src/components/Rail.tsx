import { useContext, useState } from 'react'
import { CourseContext, NavTarget, View } from '../App'

interface Props {
  view: View
  onNavigate: (v: NavTarget) => void
}

export default function Rail({ view, onNavigate }: Props) {
  const { courses, course, setCourseId } = useContext(CourseContext)
  const [open, setOpen] = useState(() => localStorage.getItem('lumen-rail-courses') !== '0')

  /** 点「我的课程」：展开/收起下级课程列表，同时回到课程列表页 */
  function toggleCourses() {
    setOpen((o) => {
      localStorage.setItem('lumen-rail-courses', o ? '0' : '1')
      return !o
    })
    onNavigate('courses')
  }

  function enterCourse(id: string) {
    setCourseId(id)
    onNavigate('workspace')
  }

  return (
    <nav className="rail">
      <button
        className={`rail-btn ${view === 'home' ? 'active' : ''}`}
        onClick={() => onNavigate('home')}
      >
        <span className="ico">🏠</span>
        <span className="rail-label">概览</span>
      </button>

      <button
        className={`rail-btn rail-parent ${view === 'courses' || view === 'workspace' ? 'active' : ''}`}
        onClick={toggleCourses}
        title="我的课程（点击展开 / 收起）"
      >
        <span className="ico">📚</span>
        <span className="rail-label">我的课程</span>
        <span className={`caret${open ? ' open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="rail-sub">
          {courses.length === 0 && <div className="rail-sub-empty">暂无课程</div>}
          {courses.map((c) => (
            <button
              key={c.id}
              className={`rail-btn sub ${view === 'workspace' && course?.id === c.id ? 'cur' : ''}`}
              title={c.name}
              onClick={() => enterCourse(c.id)}
            >
              <span className="ico dot">●</span>
              <span className="rail-label">{c.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="rail-spacer" />

      <div className="rail-bottom">
        <button
          className={`rail-btn ${view === 'tasks' ? 'active' : ''}`}
          onClick={() => onNavigate('tasks')}
        >
          <span className="ico">🖥️</span>
          <span className="rail-label">任务中心</span>
        </button>
        <button
          className={`rail-btn ${view === 'models' ? 'active' : ''}`}
          onClick={() => onNavigate('models')}
        >
          <span className="ico">🤖</span>
          <span className="rail-label">模型管理</span>
        </button>
        <button
          className={`rail-btn ${view === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="ico">⚙️</span>
          <span className="rail-label">设置</span>
        </button>
      </div>
    </nav>
  )
}
