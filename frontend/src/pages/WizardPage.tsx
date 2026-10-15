import { useContext, useEffect, useState } from 'react'
import { api, openSSE } from '../api'
import { ToastContext } from '../App'
import type { NavTarget } from '../App'
import type { Chapter, Exercise, ModelDef, Task } from '../types'

interface Props {
  go: (v: NavTarget) => void
  courseId: string
}

interface GenSpec {
  types: Record<string, number>
  difficulty: number
  explain: boolean
  answer: boolean
  model_id: string | null
}

export default function WizardPage({ go, courseId }: Props) {
  const toast = useContext(ToastContext)
  const [step, setStep] = useState(1)
  const [textbooks, setTextbooks] = useState<{ id: string; title: string }[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelDef[]>([])
  const [spec, setSpec] = useState<GenSpec>({
    types: { single: 3, judge: 2, short: 2 },
    difficulty: 3,
    explain: true,
    answer: true,
    model_id: null,
  })
  const [generating, setGenerating] = useState(false)
  const [drafts, setDrafts] = useState<Exercise[]>([])

  useEffect(() => {
    if (!courseId) return
    ;(async () => {
      const [t, m] = await Promise.all([
        api.get<{ id: string; title: string }[]>(
          `/api/v1/textbooks?course_id=${courseId}`),
        api.get<ModelDef[]>('/api/v1/models'),
      ])
      setTextbooks(t)
      setModels(m.filter((x) => x.capabilities.includes('text')))
    })().catch((e) => toast('加载失败：' + e.message))
  }, [courseId, toast])

  async function loadChapters(textbookId: string) {
    const rows = await api.get<Chapter[]>(`/api/v1/textbooks/${textbookId}/chapters`)
    setChapters(rows)
    setSelected(new Set(rows.filter((r) => r.level === 1).map((r) => r.id)))
  }

  async function startGenerate() {
    if (!courseId) return toast('请先在左侧选择课程')
    if (selected.size === 0) return toast('请至少选择一个章节')
    setGenerating(true)
    try {
      const task = await api.post<Task>('/api/v1/exercises/generate', {
        course_id: courseId,
        chapter_ids: [...selected],
        types: spec.types,
        difficulty: spec.difficulty,
        explain: spec.explain,
        answer: spec.answer,
        model_id: spec.model_id,
      })
      toast('出题任务已提交，流式跟踪中…')
      // 跟踪任务进度，完成后拉取草稿
      const es = openSSE(`/api/v1/tasks/${task.id}/events`, (ev, data) => {
        if (ev === 'task.done') {
          es.close()
          setGenerating(false)
          setStep(4)
          refreshDrafts()
        }
        if (ev === 'task.error') {
          es.close()
          setGenerating(false)
          toast('生成失败：' + (data.error || '未知错误'))
        }
      })
    } catch (e) {
      setGenerating(false)
      toast('提交失败：' + (e as Error).message)
    }
  }

  async function refreshDrafts() {
    const rows = await api.get<Exercise[]>('/api/v1/exercises?status=draft')
    setDrafts(rows)
  }

  const toggleType = (t: string) => {
    setSpec((s) => {
      const types = { ...s.types }
      if (types[t]) delete types[t]
      else types[t] = 2
      return { ...s, types }
    })
  }

  const steps = ['范围', '题型与数量', '模型', '预览与审校']

  return (
    <>
      <div className="page-head">
        <h1>🧙 出题向导</h1>
        <span className="sub">选范围 → 题型数量 → 模型 → 预览审校</span>
      </div>
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <div key={s} className={`wstep ${i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}`} data-n={i + 1}>
            {s}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="wizard-body">
          <div className="field" style={{ marginBottom: 14 }}>
            <label>选择出题范围（可多选）</label>
            {textbooks.map((tb) => (
              <div key={tb.id} style={{ marginBottom: 8 }}>
                <div className="chk" onClick={() => loadChapters(tb.id)}>
                  <div className="t">📘 {tb.title}</div>
                </div>
                {chapters.filter((c) => c.level === 1).map((ch) => (
                  <div key={ch.id} className={`chk ${selected.has(ch.id) ? 'checked' : ''}`} style={{ marginLeft: 22 }}
                    onClick={() => {
                      const next = new Set(selected)
                      next.has(ch.id) ? next.delete(ch.id) : next.add(ch.id)
                      setSelected(next)
                    }}>
                    <input type="checkbox" checked={selected.has(ch.id)} readOnly />
                    <div>
                      <div className="t">{ch.title}</div>
                      <div className="d">{ch.page_start != null ? `p.${ch.page_start}` : ''} · {ch.word_count} 字</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => setStep(2)}>下一步：题型与数量 →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-body">
          <div className="field" style={{ marginBottom: 14 }}>
            <label>题型与数量</label>
            {['single', 'multi', 'judge', 'fill', 'short', 'calc', 'essay'].map((t) => (
              <div key={t} className={`chk ${spec.types[t] ? 'checked' : ''}`} onClick={() => toggleType(t)}>
                <input type="checkbox" checked={!!spec.types[t]} readOnly />
                <div className="t" style={{ flex: 1 }}>
                  {{ single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', short: '简答题', calc: '计算题', essay: '论述题' }[t]}
                </div>
                {spec.types[t] ? (
                  <input type="number" min={1} max={50} value={spec.types[t]}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setSpec((s) => ({ ...s, types: { ...s.types, [t]: +e.target.value || 1 } }))}
                    style={{ width: 70 }} />
                ) : <span className="d">未选</span>}
              </div>
            ))}
          </div>
          <div className="field-row">
            <div className="field">
              <label>难度梯度（1-5，当前 {spec.difficulty}）</label>
              <input type="range" min={1} max={5} value={spec.difficulty} style={{ width: 220 }}
                onChange={(e) => setSpec((s) => ({ ...s, difficulty: +e.target.value }))} />
            </div>
            <div className="field">
              <label>选项</label>
              <div className={`chk ${spec.explain ? 'checked' : ''}`} style={{ maxWidth: 220 }} onClick={() => setSpec((s) => ({ ...s, explain: !s.explain }))}>
                <input type="checkbox" checked={spec.explain} readOnly /><div className="t">生成解析</div>
              </div>
              <div className={`chk ${spec.answer ? 'checked' : ''}`} style={{ maxWidth: 220 }} onClick={() => setSpec((s) => ({ ...s, answer: !s.answer }))}>
                <input type="checkbox" checked={spec.answer} readOnly /><div className="t">生成参考答案</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => setStep(3)}>下一步：选择模型 →</button>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← 上一步</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-body">
          <div className="field" style={{ marginBottom: 14 }}>
            <label>生成模型（记住该任务上次使用的模型）</label>
            {models.map((m) => (
              <div key={m.id} className={`chk ${spec.model_id === m.id ? 'checked' : ''}`}
                onClick={() => setSpec((s) => ({ ...s, model_id: m.id }))}>
                <input type="radio" name="wm" checked={spec.model_id === m.id} readOnly />
                <div>
                  <div className="t">{m.name} <span className="tag" style={{ marginLeft: 6 }}>{m.provider}</span></div>
                  <div className="d">{m.capabilities.join(' · ')} · 上下文 {m.context_length} · {m.status === 'ok' ? '连通正常' : m.status}</div>
                </div>
              </div>
            ))}
            {models.length === 0 && <div className="empty">尚未配置文本模型，请先到「模型管理」添加</div>}
          </div>
          <div className="card card-pad" style={{ background: 'var(--panel2)', marginBottom: 16 }}>
            <b>💡 提示</b><br />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              出题为结构化任务，输出受 JSON Schema 约束；答案唯一性与选项完整性会自动校验。生成物默认进入<b>草稿箱</b>，不会直接发布。
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" disabled={generating || !models.length} onClick={startGenerate}>
              {generating ? '⏳ 生成中…' : '⚡ 开始生成'}
            </button>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← 上一步</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="wizard-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="tag accent">草稿 {drafts.length} 题</span>
            <button className="btn btn-sm" onClick={refreshDrafts}>⟳ 刷新</button>
          </div>
          {drafts.map((q) => (
            <div className="qgen" key={q.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span className={`qtype ${q.type}`}>
                  {{ single: '单选', multi: '多选', judge: '判断', fill: '填空', short: '简答', calc: '计算', essay: '论述' }[q.type]}
                </span>
                <span className="tag">难度 {q.difficulty}</span>
                <span className="tag">📎 {q.source_refs && Array.isArray(q.source_refs) && (q.source_refs[0] as { chapter?: string } | undefined)?.chapter ? String((q.source_refs[0] as { chapter: string }).chapter) : ''}</span>
              </div>
              <div className="stem">{q.stem}</div>
              {q.options && Array.isArray(q.options) && (
                <div className="opts">{q.options.map((o: unknown) => <div key={String(o)}>{String(o)}</div>)}</div>
              )}
              {spec.answer && q.answer && <div className="ans">参考答案：{q.answer}</div>}
              {spec.explain && q.explanation && <div className="exp">解析：{q.explanation}</div>}
              <div className="ops">
                <button className="btn btn-sm" onClick={() => toast('编辑器为 P1 能力')}>✏️ 编辑</button>
                <button className="btn btn-sm" onClick={async () => {
                  try {
                    await api.post('/api/v1/exercises/generate', {
                      course_id: q.course_id, chapter_ids: [q.chapter_id],
                      types: { [q.type]: 1 }, difficulty: q.difficulty,
                      explain: spec.explain, answer: spec.answer, model_id: q.model_id,
                    })
                    toast('已提交重新生成')
                  } catch (e) { toast('失败：' + (e as Error).message) }
                }}>⟳ 重新生成</button>
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  await api.del(`/api/v1/exercises/${q.id}`)
                  setDrafts((d) => d.filter((x) => x.id !== q.id))
                }}>🗑 删除</button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={async () => {
              for (const q of drafts) await api.patch(`/api/v1/exercises/${q.id}`, { status: 'published' })
              await refreshDrafts()
              toast('全部已发布到题库')
            }}>📥 全部发布到题库</button>
            <button className="btn" onClick={() => go('bank')}>🗂️ 打开草稿箱</button>
            <button className="btn" onClick={() => go('quiz')}>⏱️ 直接测验</button>
            <button className="btn btn-ghost" onClick={() => setStep(3)}>← 上一步</button>
          </div>
        </div>
      )}
    </>
  )
}
