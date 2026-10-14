/** API 客户端：经 Electron IPC 获取 sidecar 端口/令牌；开发模式走 Vite 代理。 */

export interface SidecarInfo {
  port: number
  token: string
}

let infoCache: SidecarInfo | null = null

export async function getSidecarInfo(): Promise<SidecarInfo> {
  if (infoCache) return infoCache
  const w = window as any
  if (w.electron?.getSidecarInfo) {
    infoCache = await w.electron.getSidecarInfo()
    return infoCache!
  }
  // 开发模式：Vite 代理到本地 sidecar
  infoCache = {
    port: Number(import.meta.env.VITE_LUMEN_PORT ?? 8000),
    token: String(import.meta.env.VITE_LUMEN_TOKEN ?? ''),
  }
  return infoCache
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { port, token } = await getSidecarInfo()
  const isDev = !!import.meta.env.DEV
  const base = isDev ? '' : `http://127.0.0.1:${port}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message || e?.detail?.error?.message || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

/** SSE：任务进度 / 答疑流。令牌经 query 传递（EventSource 不支持自定义头）。 */
export function openSSE(path: string, onEvent: (event: string, data: any) => void, onError?: (e: unknown) => void): EventSource {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let es: EventSource
  getSidecarInfo().then(({ port, token }) => {
    const isDev = !!import.meta.env.DEV
    const base = isDev ? '' : `http://127.0.0.1:${port}`
    const sep = path.includes('?') ? '&' : '?'
    es = new EventSource(`${base}${path}${sep}token=${token}`)
    const events = ['delta', 'citation', 'done', 'error', 'task.progress', 'task.log', 'task.done', 'task.error']
    for (const ev of events) {
      es.addEventListener(ev, (e: MessageEvent) => {
        try {
          onEvent(ev, JSON.parse(e.data))
        } catch {
          onEvent(ev, e.data)
        }
      })
    }
    es.onerror = (e) => onError?.(e)
  })
  // @ts-expect-error assigned in promise
  return es
}
