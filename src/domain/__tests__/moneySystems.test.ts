import { describe, expect, it } from 'vitest'
import {
  ALL_MONEY_SYSTEMS,
  dalembert,
  dalembertFiveStep,
  dalembertReset,
  fibonacci,
  fibonacciReset,
  goodman,
  grandMartingale,
  labouchere,
  martingale,
  oneThreeTwoFour,
  oneThreeTwoSix,
  proportional,
  reverseLabouchere,
  thirtyOneSystem,
} from '../money/systems'
import type { MoneyManagementSystem } from '../money'
import { alwaysRed } from '../placement/systems'
import { simulateCombo } from '../simulation'
import type { SessionConfig, SpinOutcome } from '../types'

const L: SpinOutcome = 'loss'
const W: SpinOutcome = 'win'

/** Stake in units used on each spin of a scripted win/loss run. */
function stakes(system: MoneyManagementSystem<any>, script: SpinOutcome[]): number[] {
  let state = system.initial()
  return script.map(outcome => {
    const stake = system.multiplier(state)
    const net = outcome === 'win' ? stake : outcome === 'loss' ? -stake : 0
    state = system.next(state, outcome, net)
    return stake
  })
}

describe("D'Alembert (reset on win)", () => {
  it('adds a unit per loss and snaps back to the opening stake on a win', () => {
    // Four losses climb 1→5, then one win drops straight to 1 (not to 4).
    expect(stakes(dalembertReset, [L, L, L, L, W, L])).toEqual([1, 2, 3, 4, 5, 1])
  })

  it('differs from plain D’Alembert, which only steps down by one on a win', () => {
    const script: SpinOutcome[] = [L, L, L, W]
    expect(stakes(dalembert, script)).toEqual([1, 2, 3, 4]) // win would step 4→3 next
    expect(stakes(dalembertReset, script)).toEqual([1, 2, 3, 4]) // same until the win lands
    // The divergence shows on the spin AFTER the win.
    expect(stakes(dalembert, [...script, L])).toEqual([1, 2, 3, 4, 3])
    expect(stakes(dalembertReset, [...script, L])).toEqual([1, 2, 3, 4, 1])
  })

  it('is registered exactly once with a unique id', () => {
    const matches = ALL_MONEY_SYSTEMS.filter(s => s.id === 'dalembert-reset')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe("D'Alembert (reset on win)")
  })
})

describe('Fibonacci (reset on win)', () => {
  it('climbs the sequence on losses and drops to the start on a win', () => {
    // 1,1,2,3,5 then a win resets to 1 (not back two places to 2).
    expect(stakes(fibonacciReset, [L, L, L, L, L, W, L])).toEqual([1, 1, 2, 3, 5, 8, 1])
  })

  it('differs from standard Fibonacci, which only steps back two on a win', () => {
    const script: SpinOutcome[] = [L, L, L, L, L, W, L]
    // Standard: after the win at idx 5 (stake 8), step back two to idx 3 (stake 3).
    expect(stakes(fibonacci, script)).toEqual([1, 1, 2, 3, 5, 8, 3])
    // Reset: the same win drops straight back to the opening stake.
    expect(stakes(fibonacciReset, script)).toEqual([1, 1, 2, 3, 5, 8, 1])
  })

  it('is registered exactly once with a unique id', () => {
    const matches = ALL_MONEY_SYSTEMS.filter(s => s.id === 'fibonacci-reset')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Fibonacci (reset on win)')
  })
})

describe('Grand Martingale', () => {
  it('doubles and adds a unit, so each step out-climbs Martingale', () => {
    expect(stakes(grandMartingale, [L, L, L, L, W, L])).toEqual([1, 3, 7, 15, 31, 1])
    expect(stakes(martingale, [L, L, L, L, W, L])).toEqual([1, 2, 4, 8, 16, 1])
  })

  it('turns a profit on the recovering win, not just a break-even', () => {
    // Lose 1+3+7 = 11, then win at 15: net +4, one unit per step of the run.
    const script: SpinOutcome[] = [L, L, L, W]
    const used = stakes(grandMartingale, script)
    const net = used.reduce((sum, u, i) => sum + (script[i] === 'win' ? u : -u), 0)
    expect(net).toBe(4)
    // Standard Martingale recovers exactly one unit however long the run.
    const mUsed = stakes(martingale, script)
    expect(mUsed.reduce((sum, u, i) => sum + (script[i] === 'win' ? u : -u), 0)).toBe(1)
  })
})

describe('Reverse Labouchere', () => {
  it('grows the line on a win and shrinks it on a loss', () => {
    // Opens 1+4=5. A win appends 5 (line 1,2,3,4,5) so the next stake is 1+5=6.
    expect(stakes(reverseLabouchere, [W, W])).toEqual([5, 6])
    // A loss crosses off both ends (line 2,3) so the next stake is 2+3=5.
    expect(stakes(reverseLabouchere, [L, L])).toEqual([5, 5])
  })

  it('is the mirror of Labouchere — the same script moves it the other way', () => {
    // After one win, Labouchere shrinks its line and Reverse grows its own.
    expect(stakes(labouchere, [W, W])).toEqual([5, 5])
    expect(stakes(reverseLabouchere, [W, W])).toEqual([5, 6])
  })

  it('starts a fresh line when losses empty it', () => {
    // 1,2,3,4 -> loss -> 2,3 -> loss -> empty -> restart at 1+4.
    expect(stakes(reverseLabouchere, [L, L, L])).toEqual([5, 5, 5])
  })
})

describe('1-3-2-4', () => {
  it('walks the ladder on wins and resets on a loss', () => {
    expect(stakes(oneThreeTwoFour, [W, W, W, W, L, W])).toEqual([1, 3, 2, 4, 1, 1])
  })

  it('locks in profit after three wins, where 1-3-2-6 can still give it back', () => {
    // Three wins then a loss on the fourth step.
    const script: SpinOutcome[] = [W, W, W, L]
    const net = (sys: typeof oneThreeTwoFour) => {
      const used = stakes(sys, script)
      return used.reduce((sum, u, i) => sum + (script[i] === 'win' ? u : -u), 0)
    }
    expect(net(oneThreeTwoFour)).toBe(2) // +1+3+2-4
    expect(net(oneThreeTwoSix)).toBe(0) // +1+3+2-6 — the whole run handed back
  })
})

describe('Goodman (1-2-3-5)', () => {
  it('climbs to 5u and rides it until a loss', () => {
    expect(stakes(goodman, [W, W, W, W, W, L, W])).toEqual([1, 2, 3, 5, 5, 5, 1])
  })
})

describe('31 System (Six Pack)', () => {
  it('walks the nine-step ladder on losses', () => {
    expect(stakes(thirtyOneSystem, [L, L, L, L, L, L, L, L, L])).toEqual([
      1, 1, 1, 2, 2, 4, 4, 8, 8,
    ])
  })

  it('never risks more than 31 units across a full losing run', () => {
    const run: SpinOutcome[] = Array(9).fill(L)
    expect(stakes(thirtyOneSystem, run).reduce((a, b) => a + b, 0)).toBe(31)
  })

  it('restarts rather than escalating past the end of the ladder', () => {
    const used = stakes(thirtyOneSystem, [L, L, L, L, L, L, L, L, L, L])
    expect(used[9]).toBe(1)
  })

  it('resets to the first step on any win', () => {
    expect(stakes(thirtyOneSystem, [L, L, L, L, W, L])).toEqual([1, 1, 1, 2, 2, 1])
  })
})

describe('Percentage of Bankroll', () => {
  const ctx = (bankrollUnits: number) => ({ bankrollUnits, startingUnits: 100 })

  it('stakes a share of the current bankroll', () => {
    // 2% of 100 units = 2u; of 200 units = 4u.
    expect(proportional.multiplier(null, ctx(100))).toBeCloseTo(2, 6)
    expect(proportional.multiplier(null, ctx(200))).toBeCloseTo(4, 6)
  })

  it('shrinks as the bankroll shrinks, so a losing run cannot wipe it out', () => {
    const big = proportional.multiplier(null, ctx(100))
    const small = proportional.multiplier(null, ctx(10))
    expect(small).toBeLessThan(big)
    expect(small).toBeGreaterThan(0)
  })

  it('keeps a floor so the stake never rounds away to nothing', () => {
    expect(proportional.multiplier(null, ctx(0.001))).toBe(0.1)
  })

  it('sits out only when the bankroll is genuinely gone', () => {
    expect(proportional.multiplier(null, ctx(0))).toBe(0)
  })

  it('falls back to a flat unit when no bankroll is supplied', () => {
    expect(proportional.multiplier(null)).toBe(1)
  })

  it('scales its real stake with the bankroll through a full session', () => {
    // Always Red on eight reds: the bankroll grows, so each stake grows with it.
    const cfg: SessionConfig = {
      wheelType: 'european',
      startingBankroll: 500,
      baseUnit: 5,
    }
    const reds = [1, 3, 5, 7, 9, 12, 14, 16].map(n => ({ n, ts: 0 }))
    const result = simulateCombo(alwaysRed, proportional, reds, cfg, { trace: true })
    const staked = result.trace!.map(t => t.staked)
    // 2% of $500 = $10 to open, rising every spin as the bankroll does.
    expect(staked[0]).toBeCloseTo(10, 6)
    for (let i = 1; i < staked.length; i++) {
      expect(staked[i]).toBeGreaterThan(staked[i - 1])
    }
    expect(result.profit).toBeGreaterThan(0)
  })

  it('never goes broke on a long losing run, unlike a doubling ladder', () => {
    const cfg: SessionConfig = {
      wheelType: 'european',
      startingBankroll: 500,
      baseUnit: 5,
    }
    // Twenty straight blacks against Always Red.
    const blacks = Array.from({ length: 20 }, (_, i) => ({ n: i % 2 === 0 ? 2 : 4, ts: 0 }))
    const prop = simulateCombo(alwaysRed, proportional, blacks, cfg)
    const mart = simulateCombo(alwaysRed, martingale, blacks, cfg)
    expect(prop.ruinedAt).toBeNull()
    expect(prop.busted).toBe(false)
    // The doubling ladder cannot survive the same run on the same bankroll.
    expect(mart.ruinedAt).not.toBeNull()
  })
})

describe("D'Alembert 5-Step (reset on win)", () => {
  it('climbs a unit per loss and gives up after five', () => {
    expect(stakes(dalembertFiveStep, [L, L, L, L, L, L, L])).toEqual([1, 2, 3, 4, 5, 1, 2])
  })

  it('caps a full losing run at 15 units', () => {
    expect(stakes(dalembertFiveStep, [L, L, L, L, L]).reduce((a, b) => a + b, 0)).toBe(15)
  })

  it('resets to the opening stake on any win', () => {
    expect(stakes(dalembertFiveStep, [L, L, L, W, L])).toEqual([1, 2, 3, 4, 1])
  })

  it('differs from open-ended D’Alembert exactly at the cap', () => {
    // Identical for the first five losses, then the bounded one starts over.
    const script: SpinOutcome[] = [L, L, L, L, L, L, L]
    expect(stakes(dalembertReset, script)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(stakes(dalembertFiveStep, script)).toEqual([1, 2, 3, 4, 5, 1, 2])
  })
})

describe('money system registry', () => {
  it('has no duplicate ids or names', () => {
    const ids = ALL_MONEY_SYSTEMS.map(s => s.id)
    const names = ALL_MONEY_SYSTEMS.map(s => s.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('opens every system at a positive, finite stake', () => {
    for (const s of ALL_MONEY_SYSTEMS) {
      const opening = s.multiplier(s.initial())
      expect(Number.isFinite(opening)).toBe(true)
      expect(opening).toBeGreaterThan(0)
    }
  })

  it('never demands an absurd stake after a long losing run', () => {
    for (const s of ALL_MONEY_SYSTEMS) {
      let state = s.initial()
      for (let i = 0; i < 40; i++) {
        const stake = s.multiplier(state)
        expect(stake).toBeLessThanOrEqual(256)
        state = s.next(state, 'loss', -stake)
      }
    }
  })
})
