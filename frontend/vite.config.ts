import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发模式：/api 代理到 sidecar（默认 8000 端口，可用 VITE_LUMEN_PORT 覆盖）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.VITE_LUMEN_PORT || 8000}`,
        changeOrigin: true,
      },
    },
  },
})
