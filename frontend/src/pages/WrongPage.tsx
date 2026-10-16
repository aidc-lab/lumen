import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import { QTYPE_LABEL } from '../types'
import DoingPanel from '../components/DoingPanel'

interface WrongItem {
  entry_id: string | null
  question_id: string
  type: string
  stem: string
  options: unknown[] | null
  answer: string
  explanation: string
  wrong_count: number
  manual: boolean
}

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

interface Doing {
  attemptId: string
  questions: Array<{
    id: string; type: string; stem: string; options: unknown[] | null;
    difficulty: number; score: number; order: number; user_answer: string | string[] | null
  }>
  paper: { title: string; duration_min: number }
}

export default function WrongPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [items, setItems] = useState<WrongItem[]>([])
  const [error, setError] = useState('')
  const [doing, setDoing] = useState<Doing | null>(null)

  async function refresh() {
    if (!courseId) { setItems([]); return }
    try {
      const r = await api.get<{ items: WrongItem[] }>(
        `/api/v1/courses/${courseId}/wrong-questions`)
      setItems(r.items)
      setError('')
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => { refresh() }, [courseId])

  // 参考答案里的正确选项键（A-D / √ / ×），用于高亮正确项
  const rightKeys = (ans: string) => [...new Set(ans.match(/[A-D√×]/g) ?? [])]

  if (doing) {
    return (
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>
        <div className="page-head">
          <button className="btn btn-ghost btn-sm" onClick={() => setDoing(null)}>← 返回错题本</button>
          <h1>📝 错题专练</h1>
        </div>
        <DoingPanel
          go={go} courseId={courseId}
          attemptId={doing.attemptId}
          questions={doing.questions}
          paper={doing.paper}
          onFinish={() => { setDoing(null); go('report') }}
        />
      </div>
    )
  }

  if (!courseId) {
    return (
      <div className="card empty">
        请在左侧「我的课程」中选择课程<br /><br />
        <button className="btn btn-primary" onClick={() => go('home')}>返回首页</button>
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>📕 错题本</h1>
        <span className="sub">{items.length} 题 · 按错误次数排序</span>
        <div className="spacer" />
        {items.length > 0 && (
          <button className="btn btn-primary" onClick={() => startPractice(items.map((it) => it.question_id), items.length)}>
            错题专练（{items.length} 题）
          </button>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="bank-grid">
        {items.map((it) => {
          const opts = Array.isArray(it.options) ? it.options.map(String) : []
          const keys = rightKeys(it.answer)
          const isRight = (o: string) => keys.includes(o.trim()[0])
          return (
            <div className="bank-card" key={it.entry_id ?? it.question_id}>
              <div className="wc-top">
                <span className={`qtype ${it.type}`}>{QTYPE_LABEL[it.type] || it.type}</span>
                <div className="wc-right">
                  <span className="wc-wrong">错 {it.wrong_count} 次</span>
                  {it.manual && <span className="tag warn">手动加入</span>}
                </div>
              </div>
              <div className="wc-body">
                <div className="stem" title={it.stem}>{it.stem}</div>
                {opts.length > 0 && (
                  <div className="wopts">
                    {opts.map((o) => (
                      <div key={o} className={`wopt${isRight(o) ? ' right' : ''}`}>
                        <span className="key">{o[0]}</span>
                        <span className="txt">{o.slice(2)}</span>
                        {isRight(o) && <span className="mark">✓</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="wc-ans">
                <div className="row">
                  <span className="lb">参考答案</span>
                  <span className="val">{it.answer}</span>
                </div>
                {it.explanation && (
                  <div className="row">
                    <span className="lb">解析</span>
                    <span className="exp">{it.explanation}</span>
                  </div>
                )}
              </div>
              <div className="wc-acts">
                <button className="btn btn-sm btn-primary" onClick={() => startPractice([it.question_id], 1)}>去练习</button>
                {it.manual && (
                  <button className="btn btn-sm btn-ghost btn-danger wc-act-del" onClick={async () => {
                    await api.del(`/api/v1/courses/${courseId}/wrong-questions/${it.question_id}`)
                    toast('已从错题本移除')
                    refresh()
                  }}>移除</button>
                )}
              </div>
            </div>
          )
        })}
        {items.length === 0 && !error && (
          <div className="empty empty-card">
            <div className="ec-ico">📭</div>
            <div className="ec-t">暂无错题</div>
            <div className="ec-s">做错的题目会自动记录到这里，也可以在「题库」中手动加入</div>
            <button className="btn btn-primary" onClick={() => go('bank')}>去题库练习</button>
          </div>
        )}
      </div>
    </>
  )

  async function startPractice(forceIds: string[], count: number) {
    try {
      const r = await api.post<{
        attempt_id: string; paper_id: string;
        questions: Array<{ id: string; type: string; stem: string; options: unknown[] | null; difficulty: number; order: number; score: number }>
      }>(`/api/v1/courses/${courseId}/practice`, {
        count,
        prefer_unanswered: false,
        include_wrong: true,
        force_ids: forceIds,
      })
      setDoing({
        attemptId: r.attempt_id,
        paper: { title: '错题专练', duration_min: 0 },
        questions: r.questions.map((qq, i) => ({
          ...qq, user_answer: null, order: qq.order ?? i + 1,
        })),
      })
    } catch (e) { toast('抽题失败：' + (e as Error).message) }
  }
}
