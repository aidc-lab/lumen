import { NavTarget, View } from '../App'

interface Props {
  view: View
  onNavigate: (v: NavTarget) => void
}

export default function Rail({ view, onNavigate }: Props) {
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
        className={`rail-btn ${view === 'courses' || view === 'workspace' ? 'active' : ''}`}
        onClick={() => onNavigate('courses')}
      >
        <span className="ico">📚</span>
        <span className="rail-label">我的课程</span>
      </button>

      <div className="rail-divider" />

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
    </nav>
  )
}
