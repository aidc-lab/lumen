import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext, type NavTarget } from '../App'
import type { ModelDef, ModelTestResult } from '../types'

type Props = { go: (v: NavTarget) => void }

export default function ModelsPage({ go }: Props) {
  const toast = useContext(ToastContext)
  const [models, setModels] = useState<ModelDef[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
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

  function resetForm() {
    setEditingId(null)
    setForm({ name: '', provider: 'OpenAI 兼容', base_url: '', api_key: '', capabilities: ['text'], context_length: 8192, max_output: 4096 })
  }

  function openCreate() {
    resetForm()
    setShowForm(true)
  }

  function openEdit(m: ModelDef) {
    setEditingId(m.id)
    setForm({
      name: m.name,
      provider: m.provider,
      base_url: m.base_url,
      api_key: '',
      capabilities: m.capabilities.length ? [...m.capabilities] : ['text'],
      context_length: m.context_length,
      max_output: m.max_output || 4096,
    })
    setShowForm(true)
  }

  async function saveModel() {
    if (!form.name || !form.base_url) return toast('请填写名称与 Base URL')
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        provider: form.provider,
        base_url: form.base_url,
        capabilities: form.capabilities,
        context_length: form.context_length,
        max_output: form.max_output,
      }
      // 编辑时留空表示保留原 Key，避免误清空
      if (form.api_key.trim()) payload.api_key = form.api_key.trim()
      if (editingId) {
        await api.patch(`/api/v1/models/${editingId}`, payload)
        toast('模型已更新')
      } else {
        await api.post('/api/v1/models', payload)
        toast('模型已添加')
      }
      setShowForm(false)
      resetForm()
      refresh()
    } catch (e) {
      toast((editingId ? '更新失败：' : '添加失败：') + (e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="page-head">
        <h1>🤖 模型管理</h1>
        <span className="sub">统一经 OpenAI 兼容网关接入 · Key 本地加密（AES-256-GCM + 系统钥匙串）</span>
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={() => go('settings')}>⚙️ 默认模型设置</button>
        <button className="btn btn-primary" onClick={() => (showForm && !editingId ? setShowForm(false) : openCreate())}>＋ 新建模型</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {showForm && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{editingId ? '✏️ 编辑模型' : '＋ 新建模型'}</div>
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
            <input type="password" value={form.api_key}
              placeholder={editingId ? '留空保留原 Key' : ''}
              onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} style={{ width: '100%' }} /></div>
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
            <div className="field"><label>最大输出</label>
              <input type="number" value={form.max_output}
                onChange={(e) => setForm((f) => ({ ...f, max_output: +e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" disabled={saving} onClick={saveModel}>
              {saving ? '保存中…' : (editingId ? '保存修改' : '保存')}
            </button>
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); resetForm() }}>取消</button>
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
              <button className="btn btn-sm" onClick={() => openEdit(m)}>编辑</button>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={async () => {
                if (!window.confirm(`确认删除模型「${m.name}」？已产生的历史任务/成绩仍会保留。`)) return
                try {
                  await api.del(`/api/v1/models/${m.id}`)
                  refresh()
                  toast('已删除')
                } catch (e) { toast('删除失败：' + (e as Error).message) }
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
    </>
  )
}
