import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// frontend 是 ESM 包（"type": "module"），没有 __dirname。
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

export type LaunchedApp = {
  app: ElectronApplication
  page: Page
  dataDir: string
  close: () => Promise<void>
}

/**
 * 启动真实的 Electron 应用（Playwright 底层走 CDP）。
 *
 * 每次启动用独立的 userData 目录，否则测试之间共用同一份 SQLite，
 * 方案列表会互相污染。
 */
export async function launchApp(reuseDataDir?: string): Promise<LaunchedApp> {
  const dataDir = reuseDataDir ?? mkdtempSync(path.join(tmpdir(), 'classowl-e2e-'))
  const app = await electron.launch({
    args: [repoRoot, `--user-data-dir=${dataDir}`],
    cwd: repoRoot,
    env: { ...process.env, CLASSOWL_E2E: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // 首访欢迎层会挡住「新建方案」按钮。e2e 每次都用全新数据目录（0 方案），
  // 不豁免的话每条用例都要先过欢迎层。标记为已见过并刷新，让用例直达方案中心。
  await page.addInitScript(() => {
    try { localStorage.setItem('classowl.welcomed', '1') } catch { /* ignore */ }
  })
  await page.reload()
  return {
    app,
    page,
    dataDir,
    close: async () => {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

/** 主进程侧断言窗口真的可见——`ready-to-show` 曾经不触发，窗口停在 show:false。 */
export function isWindowVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows()
    return Boolean(window?.isVisible())
  })
}

/**
 * 新建一个空白方案并进入它的步骤 1，返回 planId。
 *
 * 「新建方案」会先弹出模板选择（空白 / 从已有方案导入，S4b 加的），
 * 所以这里要多点一次「从空白开始」。
 */
export async function createPlan(page: Page): Promise<string> {
  await page.getByRole('button', { name: '新建方案' }).click()
  await page.getByRole('button', { name: /从空白开始/ }).click()
  await page.waitForURL(/\/flow\/[^/]+\/input-information/)
  return /\/flow\/([^/]+)\//.exec(page.url())?.[1] ?? ''
}

/** 点步骤导航进入某一步（路由是 history 模式，不能靠拼 hash 跳转）。 */
export async function gotoStep(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: '排课步骤' })
    .getByRole('link', { name: new RegExp(label) })
    .click()
  await page.locator(`[data-screen-label="${label}"]`).waitFor({ timeout: 15_000 })
}

/**
 * 用演示数据填满一个方案。
 *
 * 后端新建的方案是完全空的（没有班级/课程/教师），而步骤 2–5 的用例都需要
 * 数据才能操作。走 preload 的桥直接 PUT 文档，比在 UI 上点几十次快且稳。
 */
export async function seedPlan(page: Page, planId: string): Promise<void> {
  // createDemoWorkspace 在 Node 侧求值：打包后的页面里没有 /src/*.ts 可动态 import。
  const { createDemoWorkspace } = await import('../src/workspace.ts')
  const seeded = createDemoWorkspace()
  const failure = await page.evaluate(
    async ({ id, doc }) => {
      const bridge = window.classowl
      if (!bridge) return 'preload 桥不存在'
      const current = await bridge.request(`/plans/${id}/doc`)
      if (!current.ok) return `读取文档失败 HTTP ${current.status}`
      const rev = (current.body as { rev: number }).rev
      const saved = await bridge.request(`/plans/${id}/doc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRev: rev, doc, checkpoint: null }),
      })
      return saved.ok ? '' : `写入文档失败 HTTP ${saved.status}`
    },
    { id: planId, doc: seeded },
  )
  if (failure) throw new Error(`注入演示数据失败：${failure}`)
  await page.reload()
}
