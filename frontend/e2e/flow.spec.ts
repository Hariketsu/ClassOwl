import { expect, test } from '@playwright/test'
import { createPlan, gotoStep, isWindowVisible, launchApp, seedPlan } from './app'

test('应用启动后窗口可见，方案中心可达', async () => {
  const { app, page, close } = await launchApp()
  try {
    // 主进程侧断言：ready-to-show 曾经不触发，窗口停在 show:false，
    // 页面内的断言看不出这个问题。
    expect(await isWindowVisible(app)).toBe(true)
    await expect(page.getByRole('heading', { name: '排课方案' })).toBeVisible({ timeout: 20_000 })
  } finally {
    await close()
  }
})

test('新建方案后进入五步流程，不含旧的定稿发布步骤', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    await createPlan(page)
    const steps = page.getByRole('navigation', { name: '排课步骤' }).getByRole('link')
    await expect(steps).toHaveCount(5)
    await expect(page.getByText('定稿发布')).toHaveCount(0)
  } finally {
    await close()
  }
})

test('方案内容真实落盘：重启应用后课时仍是改过的值', async () => {
  const first = await launchApp()
  const { dataDir } = first
  try {
    await first.page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    const planId = await createPlan(first.page)
    await seedPlan(first.page, planId)
    await gotoStep(first.page, '课时任课')
    await first.page.getByLabel('一年级1班语文课时').fill('6')
    // 防抖 800ms，等自动保存真的发出去。
    await first.page.waitForTimeout(2_500)
  } finally {
    await first.app.close()
  }

  // 复用同一个 userData 目录重启，验证数据真的进了 SQLite 而不只是内存。
  const second = await launchApp(dataDir)
  try {
    await second.page.getByRole('link', { name: /继续编辑|打开/ }).first().click()
    await gotoStep(second.page, '课时任课')
    await expect(second.page.getByLabel('一年级1班语文课时')).toHaveValue('6')
  } finally {
    await second.close()
  }
})

test('课时任课：修改课时后已设置课时联动更新', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    const planId = await createPlan(page)
    await seedPlan(page, planId)
    await gotoStep(page, '课时任课')

    const hours = page.getByLabel('一年级1班语文课时')
    await expect(hours).toHaveValue('8')
    await hours.fill('7')
    await expect(hours).toHaveValue('7')

    const screen = page.locator('[data-screen-label="课时任课"]')
    await expect(screen.getByText('25/30').first()).toBeVisible()
  } finally {
    await close()
  }
})

test('设置条件：保存一条条件后出现在列表并计入该类型数量', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    const planId = await createPlan(page)
    await seedPlan(page, planId)
    await gotoStep(page, '设置条件')

    const screen = page.locator('[data-screen-label="设置条件"]')
    await screen.getByRole('button', { name: '课程不排同天' }).click()

    const center = screen.locator('.s3-center')
    await center.getByLabel('保存后继续设置下一项').uncheck()
    await center.locator('.chip-list button', { hasText: '音乐' }).click()
    await center.locator('.chip-list button', { hasText: '美术' }).click()
    await screen.getByPlaceholder('可选备注').fill('音乐美术不排同天')

    await center.getByRole('button', { name: '保存' }).click()
    await expect(screen.getByText('备注：音乐美术不排同天')).toBeVisible()
    await expect(screen.getByText('音乐、美术 不排同天')).toBeVisible()
    await expect(screen.getByText('课程不排同天条件列表（共 1 条）')).toBeVisible()
  } finally {
    await close()
  }
})

test('排课调课：重新排课后可以选中、锁定并撤销一节课', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    const planId = await createPlan(page)
    await seedPlan(page, planId)
    await gotoStep(page, '排课调课')

    await page.getByRole('button', { name: '重新排课' }).click()
    const confirmButton = page.getByRole('button', { name: /打乱现在的排课结果重新排课/ })
    await expect(confirmButton).toBeEnabled({ timeout: 8_000 })
    await confirmButton.click()
    await page.getByRole('button', { name: '去手动微调' }).click()

    await expect(page.locator('.badge-blue')).toContainText(/已排 [1-9]\d*/)

    // 靠后的行不会被 sticky 的 .s4-board-head 遮住。不要用 force 点击：
    // 那会让点击落在遮挡元素上，课程实际没被选中，「锁定课程」只会 toast
    // 「请先点选一节课」。用 .selected 类确认点击真的生效——它是持久状态，
    // 而「已锁定」是会自动消失的 toast，不适合做判据。
    const lesson = page.locator('.s4-board tbody tr').last().locator('.lesson').first()
    await lesson.scrollIntoViewIfNeeded()
    await lesson.click()
    await expect(lesson).toHaveClass(/selected/)

    await page.getByRole('button', { name: '锁定课程' }).click()
    await expect(lesson).toHaveClass(/locked/)

    await page.getByRole('button', { name: '撤销' }).click()
    await expect(lesson).not.toHaveClass(/locked/)
  } finally {
    await close()
  }
})

test('撤销跨刷新仍然生效（内存栈做不到，判定 S3 是否真的接了后端）', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    const planId = await createPlan(page)
    await seedPlan(page, planId)
    await gotoStep(page, '排课调课')

    // 产生一个撤销点：重新排课
    await page.getByRole('button', { name: '重新排课' }).click()
    const confirmButton = page.getByRole('button', { name: /打乱现在的排课结果重新排课/ })
    await expect(confirmButton).toBeEnabled({ timeout: 8_000 })
    await confirmButton.click()
    await page.getByRole('button', { name: '去手动微调' }).click()
    await expect(page.locator('.badge-blue')).toContainText(/已排 [1-9]\d*/)
    const scheduled = await page.locator('.badge-blue').innerText()

    // 刷新页面：内存栈在这里会被清空，撤销按钮会变成不可用
    await page.reload()
    await gotoStep(page, '排课调课')
    await expect(page.locator('.badge-blue')).toContainText(scheduled)

    // 撤销仍然可用，且真的回退了排课结果
    await page.getByRole('button', { name: '撤销' }).click()
    await expect(page.locator('.badge-blue')).not.toContainText(scheduled, { timeout: 15_000 })
  } finally {
    await close()
  }
})

test('分级导入：从已有方案导入班级作息，不带课时任课', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    // 源方案：填满演示数据
    const source = await createPlan(page)
    await seedPlan(page, source)
    await page.getByRole('link', { name: '方案中心' }).click()

    // 目标方案：新建时选「从已有方案导入」，范围保持默认的第 1 级（班级作息）
    await page.getByRole('button', { name: '新建方案' }).click()
    await page.getByRole('button', { name: /从已有方案导入/ }).click()
    await page.getByRole('button', { name: '下一步' }).click()
    // 导入是破坏性操作，有一道确认
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/\/flow\/[^/]+\/input-information/, { timeout: 20_000 })

    // 第 1 级带来了班级，但没有课时任课
    await gotoStep(page, '课时任课')
    const screen = page.locator('[data-screen-label="课时任课"]')
    await expect(screen).toBeVisible()
    await expect(page.getByLabel('一年级1班语文课时')).toHaveCount(0)
  } finally {
    await close()
  }
})

test('预览导出：导出抽屉提供 Excel、PDF、PNG 三种格式，且各自只显示对应设置', async () => {
  const { page, close } = await launchApp()
  try {
    await page.getByRole('button', { name: '新建方案' }).waitFor({ timeout: 20_000 })
    const planId = await createPlan(page)
    await seedPlan(page, planId)
    await gotoStep(page, '预览导出')

    await page.getByRole('button', { name: '导出课表' }).click()
    const drawer = page.getByRole('dialog', { name: '导出课表' })

    for (const format of ['Excel', 'PDF', 'PNG 图片']) {
      await expect(drawer.getByRole('button', { name: format, exact: true })).toBeVisible()
    }

    await drawer.getByRole('button', { name: 'Excel', exact: true }).click()
    await expect(drawer.getByText('工作表组织')).toBeVisible()
    await expect(drawer.getByText('包含统计信息')).toBeVisible()

    await drawer.getByRole('button', { name: 'PDF', exact: true }).click()
    await expect(drawer.getByText('纸张大小')).toBeVisible()
    await expect(drawer.getByText('页面方向')).toBeVisible()
    await expect(drawer.getByText('分页方式')).toBeVisible()
    await expect(drawer.getByText('工作表组织')).toHaveCount(0)

    await drawer.getByRole('button', { name: 'PNG 图片', exact: true }).click()
    await expect(drawer.getByText('导出范围')).toBeVisible()
    await expect(drawer.getByText('图片清晰度')).toBeVisible()
    await expect(drawer.getByText('显示标题和图例')).toBeVisible()
    await expect(drawer.getByText('纸张大小')).toHaveCount(0)
  } finally {
    await close()
  }
})
