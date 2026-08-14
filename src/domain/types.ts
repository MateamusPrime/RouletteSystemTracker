// Core domain types shared across the app.

export type WheelType = 'european' | 'american'

/** A recorded spin. 0-36 are standard pockets; 37 represents "00" (American wheels). */
export interface Spin {
  n: number
  ts: number
}

export interface SessionConfig {
  wheelType: WheelType
  startingBankroll: number
  baseUnit: number
  /**
   * Real-table constraints, in currency. Used to flag combos that could not
   * actually have been played: `tableMin` applies per outside bet and to the
   * inside-bet total, the maximums apply per individual bet. 0/undefined
   * disables that check.
   */
  tableMin?: number
  tableMaxOutside?: number
  tableMaxInside?: number
  /**
   * Per-payout ceilings, keyed by the to-1 payout ('35' straight, '17' split,
   * '2' dozen/column, '1' even money, …), mirroring how online tables state
   * their limits. A tier set here wins over the coarse outside/inside maximums
   * above, which remain the fallback for tiers left blank.
   */
  tableMaxByPayout?: Record<string, number>
  /**
   * When true, bets are constrained to the table limits and played at the
   * capped amount (a Martingale that wants $640 bets the $500 ceiling and can
   * only win $500 back). When false, over/under bets are merely flagged and
   * the full amount is simulated.
   */
  clampToLimits?: boolean
  /**
   * Walk-away guardrails, in currency, measured against the starting bankroll.
   * A combo that reaches either one stops playing for the rest of the session,
   * the way a disciplined player would. Undefined or 0 means no guardrail.
   */
  stopWin?: number
  stopLoss?: number
  /** Spins a GB leg must sleep before it starts betting. */
  gbSleepSpins?: number
}

/** The payout tiers a real table quotes separate maximums for. */
export const PAYOUT_TIERS: { payout: number; label: string; example: string }[] = [
  { payout: 1, label: 'Even money', example: 'Red/Black, Odd/Even, 1-18/19-36' },
  { payout: 2, label: 'Dozen / Column', example: '1st 12, Col 1' },
  { payout: 5, label: 'Six line', example: 'Six numbers' },
  { payout: 8, label: 'Corner', example: 'Four numbers' },
  { payout: 11, label: 'Street', example: 'Three numbers' },
  { payout: 17, label: 'Split', example: 'Two numbers' },
  { payout: 35, label: 'Straight up', example: 'One number' },
]

export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  config: SessionConfig
  spins: Spin[]
}

/**
 * A single bet placed on the felt for the next spin.
 * `units` is the relative size in base units BEFORE the money-management
 * multiplier is applied. `numbers` is the set of pockets the bet covers and
 * `payout` the to-1 payout if any covered pocket hits.
 */
export interface Bet {
  label: string
  numbers: number[]
  payout: number
  units: number
  /**
   * Independent progression this bet belongs to. "GB" systems run several
   * legs at once — each keeps its own money-management state while they all
   * draw on the same bankroll. Omitted means the system has a single leg.
   */
  leg?: string
}

export type SpinOutcome = 'win' | 'loss' | 'push'
