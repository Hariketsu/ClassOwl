import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelSolver, getSolver, startSolver, type SolverJob } from './api'
import { Step4Adjust, runSolverJob } from './Step4Adjust'
import { createDemoWorkspace, type Workspace } from './workspace'

const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }
  const slots: Slot[] = []
  let cursor = 0
  let pending: { slot: Slot; effect: () => void | (() => void) }[] = []
  const changed = (before: readonly unknown[] | undefined, after: readonly unknown[] | undefined) =>
    !before || !after || before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]))

  return {
    begin() {
      cursor = 0
      pending = []
    },
    flush() {
      pending.forEach(({ slot, effect }) => {
        slot.cleanup?.()
        slot.cleanup = effect() || undefined
      })
      pending = []
    },
    reset() {
      slots.splice(0).forEach((slot) => slot.cleanup?.())
      cursor = 0
      pending = []
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.())
    },
    useState(initial: unknown) {
      const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slot.value, (next: unknown) => {
        slot.value = typeof next === 'function' ? (next as (current: unknown) => unknown)(slot.value) : next
      }]
    },
    useRef(initial: unknown) {
      const slot = slots[cursor++] ??= { value: { current: initial } }
      return slot.value
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {}
      if (changed(slot.deps, deps)) {
        slot.value = factory()
        slot.deps = deps
      }
      return slot.value
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const slot = slots[cursor++] ??= {}
      if (changed(slot.deps, deps)) {
        slot.deps = deps
        pending.push({ slot, effect })
      }
    },
  }
})

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: hooks.useEffect,
  useMemo: hooks.useMemo,
  useRef: hooks.useRef,
  useState: hooks.useState,
}))

vi.mock('./api', () => ({
  cancelSolver: vi.fn(),
  getSolver: vi.fn(),
  startSolver: vi.fn(),
}))

vi.mock('./ui', () => ({
  ConfirmModal: (props: { title: string; message: string; confirmLabel: string }) =>
    createElement('section', null, props.title, props.message, props.confirmLabel),
  LessonCard: () => createElement('span'),
  MiniSchedule: () => createElement('span'),
  Modal: (props: { title: string; children: ReactNode; closable?: boolean; footer?: ReactNode }) =>
    createElement('section', null,
      props.title,
      props.closable !== false && createElement('button', null, '关闭'),
      props.children,
      props.footer,
    ),
}))

const props = (workspace = createDemoWorkspace()) => ({
  planId: 'plan-1',
  workspace,
  onChange: vi.fn(),
  showToast: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
})

function renderStep(componentProps = props()) {
  hooks.begin()
  const tree = Step4Adjust(componentProps)
  hooks.flush()
  return { tree, html: renderToStaticMarkup(tree), props: componentProps }
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return
  }
  if (!isValidElement(node)) return
  if (predicate(node)) return node
  return findElement((node.props as { children?: ReactNode }).children, predicate)
}

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (!isValidElement(node)) return ''
  return text((node.props as { children?: ReactNode }).children)
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function startSolve(componentProps = props()) {
  let rendered = renderStep(componentProps)
  const replan = findElement(rendered.tree, (element) =>
    element.type === 'button' && ((element.props as { className?: string }).className?.startsWith('tool-btn') ?? false))
  ;(replan!.props as { onClick: () => void }).onClick()
  rendered = renderStep(componentProps)
  const confirm = findElement(rendered.tree, (element) =>
    typeof element.type === 'function' && (element.props as { title?: string }).title === '重新排课')
  ;(confirm!.props as { onConfirm: () => void }).onConfirm()
  await flush()
  return renderStep(componentProps)
}

beforeEach(() => {
  hooks.reset()
  vi.mocked(cancelSolver).mockResolvedValue({ ok: true })
  vi.mocked(startSolver).mockResolvedValue({ jobId: 'job-1' })
})

afterEach(() => {
  hooks.reset()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('后端求解接线', () => {
  it('中止后停止轮询', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.mocked(getSolver).mockResolvedValue({ status: 'running', progress: 20, message: '求解中' })

    const run = runSolverJob({
      planId: 'plan-1',
      keepExisting: false,
      label: '自动排课',
      signal: controller.signal,
      onApply: vi.fn(),
    })
    await flush()
    controller.abort()
    await vi.advanceTimersByTimeAsync(800)
    await run

    expect(getSolver).toHaveBeenCalledTimes(1)
  })

  it('应用结果时合并当前工作区，避免覆盖求解期间的编辑', async () => {
    const started = createDemoWorkspace()
    const current = { ...started, schemeName: '求解期间的新名称' }
    vi.mocked(getSolver).mockResolvedValue({
      status: 'done',
      progress: 100,
      message: '完成',
      result: { placements: [], park: [], unmet: [] },
    })
    let applied!: Workspace

    await runSolverJob({
      planId: 'plan-1',
      keepExisting: false,
      label: '自动排课',
      signal: new AbortController().signal,
      onApply: (update) => { applied = update(current) },
    })

    expect(applied.schemeName).toBe('求解期间的新名称')
    expect(applied.scheduleStatus).toBe('ready')
  })
})

describe('Step4Adjust 求解模态框', () => {
  it('渲染排课调课组件', () => {
    hooks.begin()
    const html = renderToStaticMarkup(createElement(Step4Adjust, props()))
    hooks.flush()

    expect(html).toContain('data-screen-label="排课调课"')
  })

  it('点取消排课会停止轮询并调用 cancelSolver', async () => {
    vi.useFakeTimers()
    vi.mocked(getSolver).mockResolvedValue({ status: 'running', progress: 20, message: '求解中' })
    const componentProps = props()
    let rendered = await startSolve(componentProps)

    expect(rendered.html).toContain('已用 0 秒')
    expect(rendered.html).not.toContain('>关闭<')
    const modal = findElement(rendered.tree, (element) =>
      typeof element.type === 'function' && (element.props as { title?: string }).title === '自动排课')
    const cancel = findElement((modal!.props as { footer?: ReactNode }).footer, (element) =>
      element.type === 'button' && text((element.props as { children?: ReactNode }).children) === '取消排课')
    ;(cancel!.props as { onClick: () => void }).onClick()
    await flush()
    rendered = renderStep(componentProps)

    expect(cancelSolver).toHaveBeenCalledWith('job-1')
    expect(rendered.html).toContain('排课已取消')
    await vi.advanceTimersByTimeAsync(800)
    expect(getSolver).toHaveBeenCalledTimes(1)
  })

  it('卸载时停止轮询并取消后端 job', async () => {
    vi.useFakeTimers()
    vi.mocked(getSolver).mockResolvedValue({ status: 'running', progress: 20, message: '求解中' })
    await startSolve()
    const calls = vi.mocked(getSolver).mock.calls.length

    hooks.unmount()
    await vi.advanceTimersByTimeAsync(1_200)

    expect(getSolver).toHaveBeenCalledTimes(calls)
    expect(cancelSolver).toHaveBeenCalledWith('job-1')
  })

  it('取消请求失败时也停止轮询并进入错误终态', async () => {
    vi.useFakeTimers()
    vi.mocked(getSolver).mockResolvedValue({ status: 'running', progress: 20, message: '求解中' })
    vi.mocked(cancelSolver).mockRejectedValue(new Error('取消请求失败'))
    const componentProps = props()
    let rendered = await startSolve(componentProps)
    const modal = findElement(rendered.tree, (element) =>
      typeof element.type === 'function' && (element.props as { title?: string }).title === '自动排课')
    const cancel = findElement((modal!.props as { footer?: ReactNode }).footer, (element) =>
      element.type === 'button' && text((element.props as { children?: ReactNode }).children) === '取消排课')

    ;(cancel!.props as { onClick: () => void }).onClick()
    await flush()
    rendered = renderStep(componentProps)
    await vi.advanceTimersByTimeAsync(800)

    expect(rendered.html).toContain('排课失败：取消请求失败')
    expect(getSolver).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['done', {
      status: 'done', progress: 100, message: '完成',
      result: { placements: [], park: [], unmet: [{ text: '教师张老师超量' }] },
    }, ['排入 0 节', '教师张老师超量', '去手动微调']],
    ['infeasible', {
      status: 'infeasible', progress: 100, message: '当前条件无解',
    }, ['当前条件无解', '返回']],
    ['error', {
      status: 'error', progress: 100, message: '求解器崩溃',
    }, ['排课失败：求解器崩溃', '返回']],
  ] as const)('%s 终态渲染对应内容', async (_status, job, expected) => {
    vi.mocked(getSolver).mockResolvedValue(job as SolverJob)

    const rendered = await startSolve()

    expected.forEach((value) => expect(rendered.html).toContain(value))
    expect(rendered.html).toContain('>关闭<')
  })

  it('done 没有 result 时渲染异常信息', async () => {
    vi.mocked(getSolver).mockResolvedValue({ status: 'done', progress: 100, message: '完成' })

    const rendered = await startSolve()

    expect(rendered.html).toContain('排课失败：求解完成但未返回排课结果')
  })
})
