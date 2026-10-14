import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import type { ModelDef, ModelTestResult } from '../types'

export default function ModelsPage() {
  const toast = useContext(ToastContext)
  const [models, setModels] = useState<ModelDef[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', provider: 'OpenAI 兼容', base_url: '', api_key: '',
    capabilities: ['text'], context_length: 8192, max_output: 4096,
  })
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')

  async function refresh() {
    try {
      setModels(await api.get<ModelDef[]>('/api/v1/models'))
      setError('')
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => { refresh() }, [])

  async function testModel(id: string) {
    setTesting((t) => ({ ...t, [id]: true }))
    try {
      const r = await api.post<ModelTestResult>(`/api/v1/models/${id}/test`)
      toast(`${r.ok ? '✅' : '❌'} ${r.detail}（${r.latency_ms}ms）`)
      refresh()
    } catch (e) {
      toast('测试失败：' + (e as Error).message)
    } finally {
      setTesting((t) => ({ ...t, [id]: false }))
    }
  }

  async function createModel() {
    if (!form.name || !form.base_url) return toast('请填写名称与 Base URL')
    try {
      await api.post('/api/v1/models', form)
      setShowForm(false)
      setForm({ name: '', provider: 'OpenAI 兼容', base_url: '', api_key: '', capabilities: ['text'], context_length: 8192, max_output: 4096 })
      refresh()
      toast('模型已添加')
    } catch (e) { toast('添加失败：' + (e as Error).message) }
  }

  async function setDefault(task: string, modelId: string) {
    // 通过 settings 存储任务级默认模型映射
    const { getSettings, putSettings } = await import('../settingsStore')
    const s = await getSettings()
    s[`default_model:${task}`] = modelId
    await putSettings(s)
    toast(`「${task}」默认模型已切换`)
  }

  const TASKS = ['答疑', '总结', '出题', '阅卷', '教案', '向量化']

  return (
    <>
      <div className="page-head">
        <h1>🤖 模型管理</h1>
        <span className="sub">统一经 OpenAI 兼容网关接入 · Key 本地加密（AES-256-GCM + 系统钥匙串）</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>＋ 新建模型</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {showForm && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="field-row">
            <div className="field"><label>名称</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="DeepSeek-V3" /></div>
            <div className="field"><label>提供商</label>
              <input value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Base URL（OpenAI 兼容端点，含 /v1）</label>
            <input value={form.base_url} onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              placeholder="https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1" style={{ width: '100%' }} /></div>
          <div className="field"><label>API Key（本地加密存储；本地模型可留空）</label>
            <input type="password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} style={{ width: '100%' }} /></div>
          <div className="field-row">
            <div className="field"><label>能力</label>
              {['text', 'vision', 'long_context', 'embedding'].map((c) => (
                <label key={c} style={{ marginRight: 12, fontSize: 13 }}>
                  <input type="checkbox" checked={form.capabilities.includes(c)}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      capabilities: e.target.checked
                        ? [...f.capabilities, c]
                        : f.capabilities.filter((x) => x !== c),
                    }))} /> {c}
                </label>
              ))}
            </div>
            <div className="field"><label>上下文长度</label>
              <input type="number" value={form.context_length}
                onChange={(e) => setForm((f) => ({ ...f, context_length: +e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={createModel}>保存</button>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}
      <div className="model-grid">
        {models.map((m) => (
          <div className="card model-card" key={m.id}>
            <h4>{m.name} <span className="tag">{m.provider}</span></h4>
            <div className="url">{m.base_url}</div>
            <div className="caps">
              {m.capabilities.map((c) => <span key={c} className="tag accent">{c}</span>)}
              <span className="tag">上下文 {m.context_length}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Key：{m.has_key ? '已配置 🔒' : '无需 Key'}
            </div>
            <div className="foot">
              <button className="btn btn-sm" disabled={testing[m.id]} onClick={() => testModel(m.id)}>
                {testing[m.id] ? '测试中…' : '🔌 测试连通'}
              </button>
              <button className="btn btn-sm" onClick={async () => {
                // 编辑为 P1 完整表单，这里仅演示改名
                toast('编辑表单为 P1 能力')
              }}>编辑</button>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={async () => {
                await api.del(`/api/v1/models/${m.id}`)
                refresh()
                toast('已删除')
              }}>删除</button>
              <span className="def">
                {m.status === 'ok' ? <span className="tag ok">连通正常</span>
                  : m.status === 'error' ? <span className="tag danger">连接失败</span>
                  : <span className="tag">未测试</span>}
              </span>
            </div>
          </div>
        ))}
        {models.length === 0 && !error && (
          <div className="empty">尚未配置模型 —— 云端 API（自带 Key）或自建 Ollama/LM Studio 均可</div>
        )}
      </div>
      <div className="page-head" style={{ marginTop: 22 }}>
        <h1 style={{ fontSize: 16 }}>任务级默认模型</h1>
        <span className="sub">每个任务记住上次使用的模型</span>
      </div>
      <div className="card card-pad">
        {TASKS.map((t) => (
          <div className="set-row" key={t}>
            <div className="lbl"><div className="t">{t}</div></div>
            <select onChange={(e) => setDefault(t, e.target.value)} defaultValue="">
              <option value="" disabled>选择默认模型…</option>
              {models.filter((m) => m.capabilities.includes(t === '向量化' ? 'embedding' : 'text'))
                .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </>
  )
}
