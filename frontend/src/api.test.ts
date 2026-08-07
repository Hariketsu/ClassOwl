import { afterEach, describe, expect, it, vi } from 'vitest'
import { importFrom, listPlans, putDoc } from './api'
import { createDemoWorkspace } from './workspace'

afterEach(() => vi.unstubAllGlobals())

describe('backend API', () => {
  it('uses the explicit Vite development fallback', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('[]'))
    vi.stubGlobal('fetch', fetch)

    await expect(listPlans()).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledWith('/api/v1/plans', undefined)
  })

  it('saves a workspace without creating an undo checkpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"rev":2,"undoDepth":0,"redoDepth":0}'))
    vi.stubGlobal('fetch', fetch)
    const workspace = createDemoWorkspace()

    await putDoc('plan-1', 1, workspace, null)

    const [, init] = fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ baseRev: 1, doc: workspace, checkpoint: null })
  })

  it('surfaces backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"detail":"文档版本已更新"}', { status: 409 }),
    ))

    await expect(listPlans()).rejects.toThrow('文档版本已更新')
  })

  it('imports the selected level from another plan', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"rev":3,"doc":{}}'))
    vi.stubGlobal('fetch', fetch)

    await importFrom('target', 'source', 2)

    const [path, init] = fetch.mock.calls[0]
    expect(path).toBe('/api/v1/plans/target/import-from')
    expect(JSON.parse(init.body)).toEqual({ sourcePlanId: 'source', level: 2 })
  })
})
