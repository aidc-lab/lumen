import { View } from '../App'

interface Props {
  view: View
  onNavigate: (v: View) => void
}

const NAV: { key: View; ico: string; label: string }[] = [
  { key: 'home', ico: '🏠', label: '首页' },
  { key: 'book', ico: '📖', label: '教材浏览' },
  { key: 'wizard', ico: '🧙', label: '出题向导' },
  { key: 'bank', ico: '🗂️', label: '草稿箱 / 题库' },
  { key: 'quiz', ico: '⏱️', label: '测验' },
  { key: 'report', ico: '📊', label: '成绩单' },
  { key: 'wrong', ico: '📕', label: '错题本' },
  { key: 'qa', ico: '💬', label: '答疑' },
  { key: 'models', ico: '🤖', label: '模型管理' },
  { key: 'tasks', ico: '🖥️', label: '任务中心' },
  { key: 'settings', ico: '⚙️', label: '设置' },
]

export default function Rail({ view, onNavigate }: Props) {
  return (
    <nav className="rail">
      <div className="rail-group">工作台</div>
      {NAV.map((n) => (
        <button
          key={n.key}
          className={`rail-btn ${view === n.key ? 'active' : ''}`}
          onClick={() => onNavigate(n.key)}
        >
          <span className="ico">{n.ico}</span>
          <span>{n.label}</span>
        </button>
      ))}
    </nav>
  )
}
