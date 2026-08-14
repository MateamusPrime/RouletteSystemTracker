import type { SystemSummary } from '../summary'
import type { SpinOutcome } from '../types'

/**
 * A money management system decides HOW MUCH to stake, as a multiplier of the
 * placement system's base units. It is a small state machine: `initial()`
 * seeds the state, `multiplier()` reads the current stake size, and `next()`
 * advances the state after each resolved spin.
 *
 * To add a new system: implement this interface and register it in
 * money/index.ts. Nothing else needs to change.
 */
/**
 * What the table looks like right now, for plans that size their stake off the
 * bankroll rather than off a fixed ladder. Everything is in base units, so a
 * system never has to know the currency amount of a unit.
 */
export interface MoneyContext {
  /** Bankroll available for this spin, in base units. */
  bankrollUnits: number
  /** Bankroll the session opened with, in base units. */
  startingUnits: number
}

export interface MoneyManagementSystem<S = unknown> {
  id: string
  name: string
  description: string
  initial(): S
  /** Structured breakdown for the hover card; falls back to `description`. */
  summary?: SystemSummary
  /**
   * Stake multiplier for the next spin; 0 means sit out (e.g. walked away).
   * `context` is supplied by the simulation for bankroll-proportional plans;
   * ladder-based systems ignore it, which is why it is optional.
   */
  multiplier(state: S, context?: MoneyContext): number
  /**
   * Advances the state after a resolved spin. `netUnits` is the spin's net
   * result in base units — most systems ignore it, but profit-aware systems
   * (stop-win / stop-loss guards) use it to track the session P/L.
   */
  next(state: S, outcome: SpinOutcome, netUnits?: number): S
}
