import { describe, expect, it, vi } from 'vitest'
import { listenBeforeUnload } from './useBeforeUnload'

describe('beforeunload listener', () => {
  it('only warns while enabled and removes the listener on cleanup', () => {
    let listener: ((event: BeforeUnloadEvent) => void) | undefined
    const target = {
      addEventListener: vi.fn((_type, callback) => { listener = callback }),
      removeEventListener: vi.fn(),
    } as unknown as Window

    expect(listenBeforeUnload(false, target)).toBeUndefined()
    expect(target.addEventListener).not.toHaveBeenCalled()

    const cleanup = listenBeforeUnload(true, target)
    const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent
    listener?.(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')
    cleanup?.()
    expect(target.removeEventListener).toHaveBeenCalledWith('beforeunload', listener)
  })
})
