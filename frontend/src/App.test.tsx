import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App, { CreatePlanModal, DocumentWritePipeline, PlanCenter, formatUpdatedAt } from './App'
import { SettingsPage } from './SettingsPage'
import { WelcomeScreen } from './WelcomeScreen'
import { FLOW_STEPS, type FlowPlan } from './flow'
import { createDemoWorkspace } from './workspace'

afterEach(() => vi.useRealTimers())

describe('formatUpdatedAt', () => {
  const now = new Date('2026-07-28T12:00:00+08:00')

  it('renders relative time for recent updates', () => {
    expect(formatUpdatedAt('2026-07-28T11:59:40+08:00', now)).toBe('刚刚更新')
    expect(formatUpdatedAt('2026-07-28T11:30:00+08:00', now)).toBe('30 分钟前')
    expect(formatUpdatedAt('2026-07-28T09:00:00+08:00', now)).toBe('3 小时前')
    expect(formatUpdatedAt('2026-07-26T12:00:00+08:00', now)).toBe('2 天前')
  })

  it('falls back to a localized date for older updates', () => {
    expect(formatUpdatedAt('2026-07-10T08:05:00+08:00', now)).toBe('7 月 10 日 08:05')
  })

  it('returns the raw string when it cannot be parsed', () => {
    expect(formatUpdatedAt('刚刚更新', now)).toBe('刚刚更新')
  })
})

describe('ClassOwl Flow', () => {
  it('opens with a plan center instead of the legacy workspace', () => {
    const plan: FlowPlan = {
      id: 'one',
      name: '全海小学 · 示例方案',
      academicYear: '2026-2027 学年',
      term: '秋季学期',
      updatedAt: '刚刚更新',
      progress: 5,
      status: 'ready',
      lastStep: 'preview-export',
    }
    const html = renderToStaticMarkup(
      <MemoryRouter><PlanCenter plans={[plan]} onCreate={() => undefined} /></MemoryRouter>,
    )

    expect(html).toContain('排课方案')
    expect(html).toContain('全海小学 · 示例方案')
    expect(html).toContain('新建方案')
    expect(html).not.toContain('任务总览')
  })

  it('loads persisted plans and keeps the accepted five-step workflow', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/plans']}><App /></MemoryRouter>,
    )

    expect(FLOW_STEPS.map((step) => step.label)).toEqual(['班级作息', '课时任课', '设置条件', '排课调课', '预览导出'])
    expect(html).toContain('加载中')
    expect(html).not.toContain('全海小学 · 示例方案')
  })

  it('disables importing when there are no existing plans', () => {
    const html = renderToStaticMarkup(
      <CreatePlanModal plans={[]} onCreate={() => undefined} onClose={() => undefined} />,
    )

    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*从已有方案导入/s)
    expect(html).toContain('暂无可导入的方案')
  })

  it('offers starting from a sample plan', () => {
    const html = renderToStaticMarkup(
      <CreatePlanModal plans={[]} onCreate={() => undefined} onClose={() => undefined} />,
    )

    expect(html).toContain('从示例方案开始')
  })

  it('renders the display-scale settings with four options', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><SettingsPage /></MemoryRouter>,
    )

    expect(html).toContain('显示比例')
    expect(html).toContain('方案中心')
    for (const name of ['紧凑', '标准', '舒适', '特大']) expect(html).toContain(name)
  })

  it('offers general, data and about sections in settings', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><SettingsPage /></MemoryRouter>,
    )

    for (const name of ['通用', '数据', '关于']) expect(html).toContain(name)
  })

  it('renders the first-visit welcome with three entries', () => {
    const html = renderToStaticMarkup(
      <WelcomeScreen onSample={() => undefined} onBlank={() => undefined} onImport={() => undefined} onSkip={() => undefined} />,
    )

    expect(html).toContain('看看完整示例')
    expect(html).toContain('从空白开始')
    expect(html).toContain('导入方案')
    expect(html).toContain('先随便看看')
  })
})

describe('文档写入管道', () => {
  it('串行执行飞行中的防抖保存与 checkpoint 保存', async () => {
    vi.useFakeTimers()
    let finishFirst!: (result: { rev: number; undoDepth: number; redoDepth: number }) => void
    const first = new Promise<{ rev: number; undoDepth: number; redoDepth: number }>((resolve) => {
      finishFirst = resolve
    })
    let activeWrites = 0
    let maxActiveWrites = 0
    const save = vi.fn(async (_planId, _rev, _doc, checkpoint) => {
      activeWrites += 1
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
      const result = checkpoint === null
        ? await first
        : { rev: 2, undoDepth: 1, redoDepth: 0 }
      activeWrites -= 1
      return result
    })
    const workspace = createDemoWorkspace()
    const pipeline = new DocumentWritePipeline('plan-1', 0, {
      onSaving: vi.fn(),
      onSaved: vi.fn(),
      onHistory: vi.fn(),
      onError: vi.fn(),
    }, {
      save,
      undo: vi.fn(),
      redo: vi.fn(),
    })

    pipeline.autosave(workspace)
    await vi.advanceTimersByTimeAsync(800)
    pipeline.checkpoint({ ...workspace, schemeName: 'checkpoint' }, '重新排课')
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
    finishFirst({ rev: 1, undoDepth: 0, redoDepth: 0 })
    await pipeline.idle()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][1]).toBe(1)
    expect(save.mock.calls[1][3]).toBe('重新排课')
    expect(maxActiveWrites).toBe(1)
  })

  it('undo 取消待处理防抖，返回文档不会再次触发保存', async () => {
    vi.useFakeTimers()
    let finishSave!: (result: { rev: number; undoDepth: number; redoDepth: number }) => void
    const pendingSave = new Promise<{ rev: number; undoDepth: number; redoDepth: number }>((resolve) => {
      finishSave = resolve
    })
    const workspace = createDemoWorkspace()
    const undone = { ...workspace, schemeName: '撤销后的文档' }
    const save = vi.fn(() => pendingSave)
    const undo = vi.fn().mockResolvedValue({ rev: 2, doc: undone, undoDepth: 0, redoDepth: 1 })
    const onHistory = vi.fn()
    const pipeline = new DocumentWritePipeline('plan-1', 0, {
      onSaving: vi.fn(),
      onSaved: vi.fn(),
      onHistory,
      onError: vi.fn(),
    }, {
      save,
      undo,
      redo: vi.fn(),
    })

    pipeline.autosave(workspace)
    await vi.advanceTimersByTimeAsync(800)
    pipeline.autosave({ ...workspace, schemeName: '不应覆盖撤销' })
    const history = pipeline.history('undo')
    finishSave({ rev: 1, undoDepth: 0, redoDepth: 0 })
    await history
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(onHistory).toHaveBeenCalledWith(expect.objectContaining({ doc: undone, rev: 2 }))
  })

  it('导入后用返回的 revision 执行下一次保存', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue({ rev: 8, undoDepth: 0, redoDepth: 0 })
    const pipeline = new DocumentWritePipeline('plan-1', 2, {
      onSaving: vi.fn(),
      onSaved: vi.fn(),
      onHistory: vi.fn(),
      onError: vi.fn(),
    }, {
      save,
      undo: vi.fn(),
      redo: vi.fn(),
    })

    pipeline.setRevision(7)
    pipeline.autosave(createDemoWorkspace())
    await vi.advanceTimersByTimeAsync(800)
    await pipeline.idle()

    expect(save).toHaveBeenCalledWith('plan-1', 7, expect.anything(), null)
  })
})
