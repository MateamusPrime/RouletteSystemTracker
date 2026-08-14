import type { ComboResult } from './simulation'
import type { WheelType } from './types'

/**
 * The house edge is the only thing about roulette that is knowable in advance:
 * every bet on a single-zero wheel returns 97.30% of its stake on average, and
 * 94.74% on a double-zero wheel. These functions compare a combo's actual
 * result against that expectation, and judge whether the leaderboard's lead is
 * big enough to mean anything yet.
 */

export function houseEdge(wheel: WheelType): number {
  return wheel === 'american' ? 2 / 38 : 1 / 37
}

export interface Confidence {
  /** What the combo "should" have lost, given everything it staked. */
  expectedProfit: number
  /** Actual minus expected — how far fortune ran ahead of (or behind) the maths. */
  luck: number
  /**
   * Standard deviation of the total result, in currency, from the real bet
   * mix. Even-money bets swing about 1 stake per spin; a straight-up bet
   * swings roughly 5.8 stakes.
   */
  swing: number
  /** How many standard deviations the luck is — |z| < 2 is unremarkable. */
  z: number
  /** Spins the combo actually had money on the table. */
  decided: number
  /** True when the result is well within the range of pure chance. */
  withinNoise: boolean
}

export function assessCombo(result: ComboResult, wheel: WheelType): Confidence {
  const decided = result.wins + result.losses + result.pushes
  const edge = houseEdge(wheel)
  const expectedProfit = -result.totalStaked * edge

  // The swing is computed during the simulation from the bets that were
  // actually placed. Approximating it from the stake alone would understate a
  // straight-up system by roughly six times and make noise look like an edge.
  const swing = result.swing

  const luck = result.profit - expectedProfit
  const z = swing > 0 ? luck / swing : 0
  return {
    expectedProfit,
    luck,
    swing,
    z,
    decided,
    withinNoise: Math.abs(z) < 2,
  }
}

/**
 * How willing you are to be fooled once across the WHOLE search. 0.05 means
 * "at most a 5% chance that any combo on the board clears the bar by luck".
 */
export type StrictnessLevel = 'lenient' | 'standard' | 'strict'

export const STRICTNESS_ALPHA: Record<StrictnessLevel, number> = {
  lenient: 0.1,
  standard: 0.05,
  strict: 0.01,
}

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, ~1e-9 relative
 * error). Needed because the corrected threshold lives far out in the tail,
 * where a lookup table would not have the resolution.
 */
function probit(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pLow = 0.02425
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > 1 - pLow) return -probit(1 - p)
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

/**
 * How many standard deviations a lead must clear to count as more than luck.
 *
 * This is a two-sided Bonferroni correction: to hold the chance of ANY of `n`
 * combos clearing the bar by luck at `alpha`, each one is tested at alpha/n.
 * Searching more combos raises the bar, which is why the count must be the
 * number SEARCHED rather than the number currently on screen.
 *
 * The previous heuristic (2 + ln(n)/2) grew at roughly the right rate but was
 * about twice as strict as the maths requires — with ~500 combos it demanded
 * 5.1σ, while a fair session's luckiest combo tops out near 2.9σ and a correct
 * correction asks for 3.9σ.
 */
export function significanceBar(
  comboCount: number,
  level: StrictnessLevel = 'standard',
): number {
  const n = Math.max(comboCount, 1)
  const alpha = STRICTNESS_ALPHA[level]
  return probit(1 - alpha / (2 * n))
}

export function leadIsMeaningful(
  best: ComboResult,
  runnerUp: ComboResult | null,
  comboCount: number,
  wheel: WheelType,
  level: StrictnessLevel = 'standard',
): { meaningful: boolean; reason: string } {
  const decided = best.wins + best.losses + best.pushes
  if (decided < 30) {
    return {
      meaningful: false,
      reason: `only ${decided} decided spins — far too few to separate skill from luck`,
    }
  }
  const conf = assessCombo(best, wheel)
  const threshold = significanceBar(comboCount, level)
  if (Math.abs(conf.z) < threshold) {
    return {
      meaningful: false,
      reason: `this lead is within the range of chance for ${comboCount} combos`,
    }
  }
  if (runnerUp && best.profit - runnerUp.profit < conf.swing) {
    return {
      meaningful: false,
      reason: 'the top combos are closer together than the session’s own swing',
    }
  }
  return { meaningful: true, reason: 'the lead is larger than chance comfortably explains' }
}

export function formatMoney(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}
