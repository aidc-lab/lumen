import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 读取 sidecar 端口（make dev 流程中 sidecar 先于前端启动，
// 端口写入 ~/Library/Application Support/lumen/sidecar.json）。
// sidecar 使用随机端口，前端代理需动态获取。
function sidecarPort(): number {
  const candidates = [
    // macOS
    join(homedir(), 'Library', 'Application Support', 'lumen', 'sidecar.json'),
    // Linux
    join(homedir(), '.local', 'share', 'lumen', 'sidecar.json'),
    // Windows
    join(homedir(), 'AppData', 'Roaming', 'lumen', 'sidecar.json'),
  ]
  for (const p of candidates) {
    try {
      const info = JSON.parse(readFileSync(p, 'utf-8'))
      if (info?.port) return info.port
    } catch { /* 文件不存在则尝试下一个 */ }
  }
  return 8000
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${sidecarPort()}`,
        changeOrigin: true,
      },
    },
  },
})
