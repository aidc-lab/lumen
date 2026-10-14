interface Props {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export default function TopBar({ theme, onToggleTheme }: Props) {
  return (
    <header className="topbar">
      <div className="logo">
        <div className="logo-mark">L</div>
        lumen <span className="tag accent">P0 开发版</span>
      </div>
      <div className="search">
        🔍 <input placeholder="搜索教材内容、题目、笔记…" /> <kbd>⌘K</kbd>
      </div>
      <div className="spacer" style={{ flex: 1 }} />
      <button className="btn btn-ghost btn-sm" onClick={onToggleTheme}>
        {theme === 'dark' ? '☀️ 浅色' : '🌙 深色'}
      </button>
      <span className="tag">本地模式 · 127.0.0.1</span>
    </header>
  )
}
