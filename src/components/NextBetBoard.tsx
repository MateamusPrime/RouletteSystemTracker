import type { ComboResult } from '../domain/simulation'
import { BoardView } from './BoardView'

interface Props {
  nextBets: ComboResult['nextBets']
  /** Shown when the system places nothing next spin. */
  emptyLabel?: string
  compact?: boolean
}

function money(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}

/**
 * The felt showing where to put chips on the NEXT spin and how much — the thing
 * you actually act on at the table. Reuses the read-only board; there is no
 * winning pocket yet, so nothing is ringed.
 */
export function NextBetBoard({ nextBets, emptyLabel = 'Sits out the next spin', compact }: Props) {
  if (nextBets.length === 0) {
    return <div className="muted next-bet-empty">{emptyLabel}</div>
  }
  const total = nextBets.reduce((s, b) => s + b.amount, 0)
  return (
    <div className={`next-bet ${compact ? 'compact' : ''}`}>
      <BoardView
        bets={nextBets.map(b => ({ ...b, won: false }))}
        hit={-1}
      />
      <div className="next-bet-list">
        {nextBets.map((b, i) => (
          <span className="next-bet-pill" key={i}>
            {money(b.amount)} on {b.label}
          </span>
        ))}
        <span className="next-bet-total">Total {money(total)}</span>
      </div>
    </div>
  )
}
