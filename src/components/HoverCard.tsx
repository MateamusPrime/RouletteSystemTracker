import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Delay before a hover card appears. Long enough that skimming the leaderboard
 * never triggers a pop-up, short enough that a deliberate hover feels instant.
 */
const HOVER_DELAY_MS = 600
/**
 * Grace period after the pointer leaves. Without it the card would vanish
 * while you were reaching for it, which makes a scrollable card unusable.
 */
const CLOSE_DELAY_MS = 220
const CARD_WIDTH = 380

/** Only one card should ever be open; opening a new one dismisses the last. */
let closeOpenCard: (() => void) | null = null

interface Props {
  /** Rendered card contents. */
  card: React.ReactNode
  children: React.ReactNode
}

/**
 * Wraps inline content with an explanatory card that appears after a
 * deliberate hover. The card is interactive — you can move onto it and scroll
 * a long system summary — and closes once the pointer has left both the
 * trigger and the card itself.
 */
export function HoverCard({ card, children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const anchor = useRef<HTMLSpanElement>(null)

  const clearTimers = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    openTimer.current = undefined
    closeTimer.current = undefined
  }

  const close = useCallback(() => {
    clearTimers()
    setPos(null)
    if (closeOpenCard === close) closeOpenCard = null
  }, [])

  useEffect(() => {
    return () => {
      clearTimers()
      if (closeOpenCard === close) closeOpenCard = null
    }
  }, [close])

  // Escape always dismisses, which matters now the card can hold focus.
  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pos, close])

  const open = () => {
    window.clearTimeout(closeTimer.current)
    if (pos) return // already showing
    window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      if (closeOpenCard && closeOpenCard !== close) closeOpenCard()
      closeOpenCard = close
      // Keep the card on screen: clamp horizontally, flip above near the
      // bottom; its own max-height handles the rest.
      const x = Math.max(8, Math.min(r.left, window.innerWidth - CARD_WIDTH - 8))
      const above = r.bottom + 320 > window.innerHeight && r.top > window.innerHeight / 2
      setPos({ x, y: above ? r.top - 6 : r.bottom + 6, above })
    }, HOVER_DELAY_MS)
  }

  /** Start closing, but give the pointer time to reach the card. */
  const scheduleClose = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY_MS)
  }

  const keepOpen = () => window.clearTimeout(closeTimer.current)

  return (
    <span
      ref={anchor}
      className="hover-anchor"
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className="hover-card"
            style={{
              left: pos.x,
              top: pos.above ? undefined : pos.y,
              bottom: pos.above ? window.innerHeight - pos.y : undefined,
              width: CARD_WIDTH,
            }}
            onMouseEnter={keepOpen}
            onMouseLeave={scheduleClose}
            // The card sits over the leaderboard; clicks inside it should not
            // select whatever row happens to be underneath.
            onClick={e => e.stopPropagation()}
          >
            {card}
          </div>,
          document.body,
        )}
    </span>
  )
}
