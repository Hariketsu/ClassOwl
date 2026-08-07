import { defineConfig } from '@playwright/test'

// e2e 跑真实 Electron 应用（_electron.launch，底层是 CDP），不再跑
// 浏览器 + vite dev server：真 preload、真令牌握手、真 SQLite、真
// classowl:// 协议——这几处正是接线阶段出 bug 的地方，浏览器里测不到。
//
// 前置：先 `npm run build:electron` 与 `npm --prefix frontend run build`。
export default defineConfig({
  testDir: './e2e',
  // 每个测试启动一个 Electron 实例，并行会抢 requestSingleInstanceLock。
  workers: 1,
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
})
