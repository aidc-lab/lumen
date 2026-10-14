import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { View } from '../App'
import type { Course, Task, Textbook } from '../types'

interface Props {
  go: (v: View) => void
}

export default function HomePage({ go }: Props) {
  const toast = useContext(ToastContext)
  const [courses, setCourses] = useState<Course[]>([])
  const [textbooks, setTextbooks] = useState<Textbook[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [c, t, j] = await Promise.all([
          api.get<Course[]>('/api/v1/courses'),
          api.get<Textbook[]>('/api/v1/textbooks'),
          api.get<Task[]>('/api/v1/tasks?limit=5'),
        ])
        setCourses(c)
        setTextbooks(t)
        setTasks(j)
      } catch (e) {
        setError(String(e))
        toast('无法连接本地服务：' + String(e))
      }
    })()
  }, [toast])

  return (
    <>
      <div className="page-head">
        <h1>下午好 👋</h1>
        <span className="sub">本地优先 · 数据留在本机</span>
        <div className="spacer" />
        <button className="btn" onClick={() => document.querySelector<HTMLInputElement>('#import-file')?.click()}>
          📥 导入教材
        </button>
        <input id="import-file" type="file" accept=".pdf,.docx,.md,.txt,.epub" style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f && courses[0]) {
              const filePath = (f as File & { path?: string }).path || ''
              if (!filePath) return toast('请通过 Electron 外壳导入（浏览器模式无法获取文件路径）')
              api.post('/api/v1/textbooks/import', { course_id: courses[0].id, file_path: filePath })
                .then(() => { toast('导入任务已提交 → 任务中心'); go('tasks') })
                .catch((err) => toast('导入失败：' + err.message))
            } else if (f) {
              toast('请先创建课程再导入教材')
            }
          }} />
        <button className="btn btn-primary" onClick={() => go('wizard')}>＋ 新建出题任务</button>
      </div>
      {error && <div className="error-box">无法连接 sidecar：{error}</div>}
      <div className="stat-grid">
        <div className="card stat"><div className="num">{courses.length}</div><div className="lbl">课程</div></div>
        <div className="card stat"><div className="num">{textbooks.length}</div><div className="lbl">教材</div></div>
        <div className="card stat"><div className="num">{textbooks.reduce((s, t) => s + t.word_count, 0).toLocaleString()}</div><div className="lbl">总字数</div></div>
        <div className="card stat"><div className="num">{tasks.filter((t) => t.status === 'running').length}</div><div className="lbl">运行中任务</div></div>
      </div>
      <div className="quick">
        <button className="btn" onClick={() => go('book')}>📖 打开教材</button>
        <button className="btn" onClick={() => go('qa')}>💬 提问答疑</button>
        <button className="btn" onClick={() => go('wizard')}>🧙 生成习题</button>
        <button className="btn" onClick={() => go('quiz')}>⏱️ 开始测验</button>
      </div>
      <div className="page-head"><h1 style={{ fontSize: 16 }}>课程</h1></div>
      <div className="dash-grid">
        {courses.map((c) => (
          <div className="card course-card" key={c.id} onClick={() => go('book')}>
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
          <div className="card course-card" onClick={() => toast('P0：请通过 API 或设置页创建课程')}>
            <h3 style={{ color: 'var(--faint)' }}>＋ 新建课程</h3>
            <div className="meta">创建课程、导入教材、设置教学目标</div>
          </div>
        )}
      </div>
      <div className="page-head" style={{ marginTop: 22 }}>
        <h1 style={{ fontSize: 16 }}>最近任务</h1>
        <div className="spacer" />
      </div>
      {tasks.slice(0, 2).map((t) => (
        <div className="card task-item" key={t.id}>
          <div className="task-top">
            <span style={{ fontSize: 16 }}>⚙️</span>
            <span className="name">{t.task_type} · {t.id.slice(0, 8)}</span>
            {t.status === 'running' && <span className="tag accent">运行中</span>}
            {t.status === 'completed' && <span className="tag ok">已完成</span>}
            {t.status === 'failed' && <span className="tag danger">失败</span>}
          </div>
          <div className="progress"><div style={{ width: `${t.progress}%` }} /></div>
          <div className="task-meta">
            <span>{t.task_type}</span><span>{Math.round(t.progress)}%</span>
            {t.tokens_out > 0 && <span>token {t.tokens_in}/{t.tokens_out}</span>}
          </div>
        </div>
      ))}
    </>
  )
}
