import { useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { ToastContext } from '../App'
import { getSettings, putSettings } from '../settingsStore'

const TASKS = ['答疑', '总结', '出题', '阅卷', '教案', '向量化']
const CAP = (t: string) => (t === '向量化' ? 'embedding' : 'text')
const ICO: Record<string, string> = { 答疑: '💬', 总结: '📝', 出题: '✏️', 阅卷: '📊', 教案: '📚', 向量化: '🧲' }

type M = { id: string; name: string; capabilities: string[]; default_for?: Record<string, boolean> | null }

export default function SettingsPage() {
  const toast = useContext(ToastContext)
  const [models, setModels] = useState<M[]>([])
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [dim, setDim] = useState('1024')

  useEffect(() => {
    ;(async () => {
      const [m, s] = await Promise.all([
        api.get<M[]>('/api/v1/models'),
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

  /** 该任务可用的模型（按能力过滤） */
  function eligible(task: string) {
    const cap = CAP(task)
    return models.filter((m) => m.capabilities.includes(cap))
  }

  /** 实际展示值：已保存 > 模型自带任务默认 > 首个可用（永远是一个真实模型，与后端 resolve 一致） */
  function effective(task: string) {
    const opts = eligible(task)
    const saved = defaults[task]
    if (saved && opts.some((m) => m.id === saved)) return saved
    return opts.find((m) => m.default_for?.[task])?.id ?? opts[0]?.id ?? ''
  }

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
      <div className="page-head">
        <h1>⚙️ 设置</h1>
        <span className="sub">本地配置 · 全部保存在本机</span>
      </div>
      <div className="set-grid">
        <div className="card card-pad sc-card">
          <div className="sc-head">
            <span className="sc-ico">🤖</span>
            <div>
              <div className="sc-t">模型默认策略</div>
              <div className="sc-d">各任务执行时自动使用的默认模型，可随时切换</div>
            </div>
          </div>
          {TASKS.map((t) => (
            <div className="set-row" key={t}>
              <span className="set-ico">{ICO[t]}</span>
              <div className="lbl"><div className="t">{t}</div></div>
              <select
                className="td-select"
                value={effective(t)}
                disabled={eligible(t).length === 0}
                onChange={(e) => saveDefault(t, e.target.value)}
              >
                {eligible(t).length === 0 && (
                  <option value="">{models.length === 0 ? '加载中…' : '暂无可用模型'}</option>
                )}
                {eligible(t).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="card card-pad sc-card">
          <div className="sc-head">
            <span className="sc-ico">🧲</span>
            <div>
              <div className="sc-t">嵌入与向量检索</div>
              <div className="sc-d">章节向量化所用的模型与维度</div>
            </div>
          </div>
          <div className="set-row">
            <div className="lbl">
              <div className="t">向量维度</div>
              <div className="d">bge-m3 默认 1024；更换模型后需重建索引</div>
            </div>
            <input className="dim-input" value={dim} onChange={(e) => setDim(e.target.value)} inputMode="numeric" />
            <span className="unit">维</span>
          </div>
          <div className="set-row">
            <div className="lbl"><div className="t">当前默认嵌入模型</div></div>
            <select
              className="td-select"
              value={effective('向量化')}
              disabled={eligible('向量化').length === 0}
              onChange={(e) => saveDefault('向量化', e.target.value)}
            >
              {eligible('向量化').length === 0 && (
                <option value="">{models.length === 0 ? '加载中…' : '暂无可用模型'}</option>
              )}
              {eligible('向量化').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="sc-foot">
            <span className="dim-hint">更改维度后需重建向量索引</span>
            <button className="btn btn-sm btn-primary" onClick={saveDim}>保存维度</button>
          </div>
        </div>
        <div className="card card-pad sc-card">
          <div className="sc-head">
            <span className="sc-ico">🔐</span>
            <div>
              <div className="sc-t">数据与隐私</div>
              <div className="sc-d">local-first：教材、作答与配置都在本机</div>
            </div>
          </div>
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
      </div>
    </>
  )
}
