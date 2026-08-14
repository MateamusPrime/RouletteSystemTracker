import { useEffect } from 'react'

interface Handlers {
  up?(): void
  down?(): void
  left?(): void
  right?(): void
}

/** Typing in a field should never be hijacked by the shortcuts. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Arrow-key shortcuts. Each owner binds only the axis it understands — the
 * leaderboard walks rows with up/down, the timeline scrubs spins with
 * left/right — so a session can be reviewed without the mouse.
 */
export function useArrowKeys(handlers: Handlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const run =
        e.key === 'ArrowUp'
          ? handlers.up
          : e.key === 'ArrowDown'
            ? handlers.down
            : e.key === 'ArrowLeft'
              ? handlers.left
              : e.key === 'ArrowRight'
                ? handlers.right
                : undefined
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers, enabled])
}
