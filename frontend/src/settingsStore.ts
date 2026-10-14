/** 设置读写辅助：任务级默认模型等存储在 settings 表。 */
import { api } from './api'

export async function getSettings(): Promise<Record<string, string>> {
  const r = await api.get<{ settings: Record<string, string> }>('/api/v1/settings')
  return r.settings ?? {}
}

export async function putSettings(s: Record<string, string>): Promise<void> {
  await api.put('/api/v1/settings', s)
}

export async function getDefaultModel(task: string): Promise<string | null> {
  const s = await getSettings()
  return s[`default_model:${task}`] ?? null
}
