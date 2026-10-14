import { useContext, useEffect, useState } from 'react'
import { api, openSSE } from '../api'
import { ToastContext } from '../App'
import type { Task } from '../types'

const TYPE_ICON: Record<string, string> = {
  教材导入: '📥', 章节向量化: '🧮', 章节总结: '📝', 出题: '🧙', 阅卷: '✅',
}

export default function TasksPage() {
  const toast = useContext(ToastContext)
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    try {
      setTasks(await api.get<Task[]>('/api/v1/tasks?limit=100'))
      setError('')
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => {
    refresh()
    // 对运行中的任务订阅 SSE 进度
    const running = tasks.filter((t) => t.status === 'running')
    const closes: (() => void)[] = []
    for (const t of running) {
      const es = openSSE(`/api/v1/tasks/${t.id}/events`, () => refresh())
      closes.push(() => es.close())
    }
    return () => closes.forEach((c) => c())
  }, [tasks.filter((t) => t.status === 'running').length])

  async function cancel(id: string) {
    try {
      await api.post(`/api/v1/tasks/${id}/cancel`)
      toast('已取消')
      refresh()
    } catch (e) { toast('取消失败：' + (e as Error).message) }
  }

  return (
    <>
      <div className="page-head">
        <h1>🖥️ 任务中心</h1>
        <span className="sub">
          {tasks.filter((t) => t.status === 'running').length} 个运行中 · 异步执行、可取消
        </span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={refresh}>⟳ 刷新</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {tasks.map((t) => (
        <div className="card task-item" key={t.id}>
          <div className="task-top">
            <span style={{ fontSize: 16 }}>{TYPE_ICON[t.task_type] ?? '⚙️'}</span>
            <span className="name">{t.task_type} · {describeParams(t.params)}</span>
            {t.status === 'running' && <span className="tag accent">运行中</span>}
            {t.status === 'completed' && <span className="tag ok">已完成</span>}
            {t.status === 'failed' && <span className="tag danger">失败</span>}
            {t.status === 'canceled' && <span className="tag">已取消</span>}
            <div className="ops">
              {t.status === 'running' && (
                <button className="btn btn-sm btn-danger" onClick={() => cancel(t.id)}>取消</button>
              )}
              {t.status === 'failed' && (
                <button className="btn btn-sm" onClick={() => toast('重试为 P1 能力（将切换备用模型）')}>⟳ 重试</button>
              )}
            </div>
          </div>
          <div className="progress"><div style={{ width: `${t.progress}%` }} /></div>
          <div className="task-meta">
            <span>{t.id.slice(0, 8)}</span>
            <span>{Math.round(t.progress)}%</span>
            {t.tokens_out > 0 && <span>token {t.tokens_in.toLocaleString()} / {t.tokens_out.toLocaleString()}</span>}
            {t.started_at && <span>开始 {t.started_at.slice(11, 19)}</span>}
          </div>
          {t.error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>✗ {t.error}</div>}
          {t.logs.length > 0 && (
            <div className="task-log">
              {t.logs.map(([level, line], i) => (
                <div key={i} className={level || ''}>{line || '\u00a0'}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {tasks.length === 0 && !error && <div className="empty">暂无任务 —— 导入教材、生成总结或出题后会显示在这里</div>}
    </>
  )
}

function describeParams(params?: Record<string, unknown>): string {
  if (!params) return ''
  const p: string[] = []
  if (params.title) p.push(String(params.title))
  if (params.chapter_ids && Array.isArray(params.chapter_ids)) p.push(`${params.chapter_ids.length} 章`)
  if (params.chapter_id) p.push('单章')
  if (params.textbook_id) p.push('教材')
  return p.join(' · ')
}
