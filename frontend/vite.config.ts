import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 下前端资源由主进程经 classowl:// 协议加载，不再由 Python 提供静态文件；
// 后端端口每次启动随机，由 preload 经 IPC 注入，因此不配固定端口的 dev 代理。
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
