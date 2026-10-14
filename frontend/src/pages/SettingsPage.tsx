import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import { getDefaultModel, getSettings, putSettings } from '../settingsStore'

const TASKS = ['答疑', '总结', '出题', '阅卷', '教案', '向量化']

export default function SettingsPage() {
  const toast = useContext(ToastContext)
  const [models, setModels] = useState<{ id: string; name: string; capabilities: string[] }[]>([])
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [dim, setDim] = useState('1024')

  useEffect(() => {
    ;(async () => {
      const [m, s] = await Promise.all([
        api.get<{ id: string; name: string; capabilities: string[] }[]>('/api/v1/models'),
        getSettings(),
      ])
      setModels(m)
      const d: Record<string, string> = {}
      for (const t of TASKS) {
        const v = s[`default_model:${t}`]
        if (v) d[t] = v
      }
      setDefaults(d)
      if (s['embedding_dim']) setDim(s['embedding_dim'])
    })().catch((e) => toast('加载失败：' + e.message))
  }, [toast])

  async function saveDefault(task: string, modelId: string) {
    const s = await getSettings()
    s[`default_model:${task}`] = modelId
    await putSettings(s)
    setDefaults((d) => ({ ...d, [task]: modelId }))
    toast(`「${task}」默认模型已保存`)
  }

  async function saveDim() {
    const s = await getSettings()
    s['embedding_dim'] = dim
    await putSettings(s)
    toast('嵌入维度已保存（更改后需重建向量索引）')
  }

  return (
    <>
      <div className="page-head"><h1>⚙️ 设置</h1></div>
      <div className="set-grid">
        <div className="card card-pad">
          <h4 style={{ marginBottom: 10 }}>模型默认策略</h4>
          {TASKS.map((t) => (
            <div className="set-row" key={t}>
              <div className="lbl"><div className="t">{t}</div></div>
              <select value={defaults[t] ?? ''} onChange={(e) => saveDefault(t, e.target.value)}>
                <option value="" disabled>选择默认模型…</option>
                {models
                  .filter((m) => m.capabilities.includes(t === '向量化' ? 'embedding' : 'text'))
                  .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="card card-pad">
          <h4 style={{ marginBottom: 10 }}>嵌入模型</h4>
          <div className="set-row">
            <div className="lbl">
              <div className="t">向量维度（embedding_dim）</div>
              <div className="d">bge-m3 默认 1024；更换模型后需重建索引</div>
            </div>
            <input value={dim} onChange={(e) => setDim(e.target.value)} style={{ width: 90 }} />
          </div>
          <div className="set-row">
            <div className="lbl"><div className="t">当前默认嵌入模型</div></div>
            <select value={defaults['向量化'] ?? ''} onChange={(e) => saveDefault('向量化', e.target.value)}>
              <option value="" disabled>选择嵌入模型…</option>
              {models.filter((m) => m.capabilities.includes('embedding'))
                .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={saveDim}>保存维度</button>
          </div>
        </div>
        <div className="card card-pad">
          <h4 style={{ marginBottom: 10 }}>数据与隐私</h4>
          <div className="set-row">
            <div className="lbl">
              <div className="t">备份知识库</div>
              <div className="d">导出为 .lumen 归档（SQLite + 原文 + 配置）</div>
            </div>
            <button className="btn btn-sm" onClick={() => toast('.lumen 归档导出为 P3 能力')}>⬇️ 立即备份</button>
          </div>
          <div className="set-row">
            <div className="lbl"><div className="t">遥测与崩溃报告</div><div className="d">默认关闭，仅本地日志</div></div>
            <span className="tag ok">已关闭</span>
          </div>
          <div className="set-row">
            <div className="lbl"><div className="t">本地服务</div><div className="d">127.0.0.1 · 随机端口 · 令牌认证</div></div>
            <span className="tag ok">运行中</span>
          </div>
        </div>
        <div className="card card-pad">
          <h4 style={{ marginBottom: 10 }}>快捷键</h4>
          {[['⌘K', '全局搜索'], ['⌘N', '新建课程'], ['⌘W', '关闭标签'], ['⌘E', '导出'], ['⌘,', '打开设置']].map(([k, d]) => (
            <div className="set-row" key={k}>
              <div className="lbl"><div className="t">{d}</div></div>
              <kbd>{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
