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
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {}
  if (!isForm) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
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

/** POST 版 SSE：EventSource 只支持 GET，答疑等用 POST 返回流的接口需要 fetch 读流。
 *  解析 `event: xxx` / `data: yyy` 分块后回调 onEvent。 */
export async function openPostSSE(
  path: string,
  body: unknown,
  onEvent: (event: string, data: any) => void,
  onError?: (e: unknown) => void,
): Promise<{ close: () => void }> {
  const { port, token } = await getSidecarInfo()
  const isDev = !!import.meta.env.DEV
  const base = isDev ? '' : `http://127.0.0.1:${port}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body ?? {}),
  })
  if (!res.ok || !res.body) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message || e?.detail?.error?.message || res.statusText)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let closed = false

  const pump = async () => {
    while (!closed) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        let ev = 'message'
        const dataLines: string[] = []
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (!dataLines.length) continue
        const raw = dataLines.join('\n')
        try { onEvent(ev, JSON.parse(raw)) } catch { onEvent(ev, raw) }
      }
    }
  }
  pump().catch((e) => { if (!closed) onError?.(e) })
  return { close: () => { closed = true; reader.cancel().catch(() => {}) } }
}

/** SSE：任务进度 / 答疑流。令牌经 query 传递（EventSource 不支持自定义头）。
 *  注意：EventSource 在 openSSE 内部异步创建，此处返回带 close() 的句柄，
 *  调用方经 esp.close() 关闭（直接返回内部 es 会因异步赋值为 undefined）。 */
export function openSSE(path: string, onEvent: (event: string, data: any) => void, onError?: (e: unknown) => void): { close: () => void } {
  let inner: EventSource | undefined
  getSidecarInfo().then(({ port, token }) => {
    const isDev = !!import.meta.env.DEV
    const base = isDev ? '' : `http://127.0.0.1:${port}`
    const sep = path.includes('?') ? '&' : '?'
    inner = new EventSource(`${base}${path}${sep}token=${token}`)
    const events = ['delta', 'citation', 'done', 'error', 'task.progress', 'task.log', 'task.done', 'task.error']
    for (const ev of events) {
      inner.addEventListener(ev, (e: MessageEvent) => {
        try {
          onEvent(ev, JSON.parse(e.data))
        } catch {
          onEvent(ev, e.data)
        }
      })
    }
    inner.onerror = (e) => onError?.(e)
  }).catch((e) => onError?.(e))
  return { close: () => inner?.close() }
}
