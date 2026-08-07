import { useEffect } from 'react'

export function listenBeforeUnload(enabled: boolean, target: Window = window) {
  if (!enabled) return
  const listener = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ''
  }
  target.addEventListener('beforeunload', listener)
  return () => target.removeEventListener('beforeunload', listener)
}

export const useBeforeUnload = (enabled: boolean) => useEffect(() => listenBeforeUnload(enabled), [enabled])
