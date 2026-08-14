import type { SystemSummary } from '../summary'
import type { Bet, SessionConfig, Spin } from '../types'

export interface PlacementContext {
  /** All spins recorded so far, oldest first. */
  spins: Spin[]
  config: SessionConfig
}

/**
 * A placement system decides WHERE chips go on the next spin, expressed in
 * relative base units. Money management scales those units up or down.
 *
 * To add a new system: create an object implementing this interface and
 * register it in placement/index.ts. Nothing else needs to change.
 */
export interface PlacementSystem {
  id: string
  name: string
  description: string
  /** Bets to place for the next spin, given the history so far. */
  bets(ctx: PlacementContext): Bet[]
  /** Structured breakdown for the hover card; falls back to `description`. */
  summary?: SystemSummary
  /**
   * True when the system carries its own staking progression (step systems),
   * so pairing it with flat betting means "run it exactly as designed".
   */
  selfManaged?: boolean
  /**
   * Number of completed cycles in the given history. A cycle ends whenever the
   * system returns to its opening bet. When present, money management is
   * applied PER CYCLE — the stake multiplier holds steady while a cycle plays
   * out and only reacts once the whole cycle has won or lost. Without this,
   * an overlay like Martingale would escalate on the intermediate losses that
   * a step system's own progression is designed to absorb.
   */
  cycleCount?(ctx: PlacementContext): number
}
