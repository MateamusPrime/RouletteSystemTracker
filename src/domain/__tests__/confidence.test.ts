import { describe, expect, it } from 'vitest'
import { assessCombo, houseEdge, leadIsMeaningful, significanceBar } from '../confidence'
import type { ComboResult } from '../simulation'

function combo(over: Partial<ComboResult> = {}): ComboResult {
  return {
    placementId: 'p',
    placementName: 'P',
    placementDescription: '',
    moneyId: 'm',
    moneyName: 'M',
    moneyBaseName: 'M',
    moneyDescription: '',
    bankrollSeries: [],
    profit: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    sitOuts: 0,
    totalStaked: 0,
    maxDrawdown: 0,
    peakStake: 0,
    swing: 0,
    busted: false,
    currentStreak: 0,
    nextBets: [] as ComboResult['nextBets'],
    selfManaged: false,
    cyclesCompleted: 0,
    limitBreaches: 0,
    firstBreach: null,
    cappedSpins: 0,
    firstCap: null,
    raisedSpins: 0,
    firstRaise: null,
    unaffordableSpins: 0,
    ruinedAt: null,
    stoppedAt: null,
    stopReason: null,
    ...over,
  }
}

describe('house edge', () => {
  it('is 2.70% single zero and 5.26% double zero', () => {
    expect(houseEdge('european')).toBeCloseTo(0.027, 3)
    expect(houseEdge('american')).toBeCloseTo(0.0526, 4)
  })
})

describe('expectation vs luck', () => {
  it('expects a small loss proportional to everything staked', () => {
    const c = assessCombo(
      combo({ totalStaked: 1000, profit: 0, wins: 100, losses: 100, swing: 70 }),
      'european',
    )
    expect(c.expectedProfit).toBeCloseTo(-27.03, 1)
    // Breaking even is actually running slightly ahead of the maths.
    expect(c.luck).toBeCloseTo(27.03, 1)
  })

  it('calls a modest result noise, and a wild one not', () => {
    const modest = assessCombo(
      combo({ totalStaked: 1000, profit: 20, wins: 100, losses: 100, swing: 70 }),
      'european',
    )
    expect(modest.withinNoise).toBe(true)

    const wild = assessCombo(
      combo({ totalStaked: 1000, profit: 900, wins: 100, losses: 100, swing: 70 }),
      'european',
    )
    expect(wild.withinNoise).toBe(false)
  })

  it('judges the same profit differently depending on how wildly it swings', () => {
    // Identical money, but a straight-up system swings far harder — so the
    // same result is unremarkable for it and startling for an even-money one.
    const steady = assessCombo(
      combo({ totalStaked: 1000, profit: 300, wins: 100, losses: 100, swing: 70 }),
      'european',
    )
    const wild = assessCombo(
      combo({ totalStaked: 1000, profit: 300, wins: 100, losses: 100, swing: 410 }),
      'european',
    )
    expect(steady.withinNoise).toBe(false)
    expect(wild.withinNoise).toBe(true)
    expect(Math.abs(wild.z)).toBeLessThan(Math.abs(steady.z))
  })

  it('reports no swing for a combo that never bet', () => {
    const c = assessCombo(combo(), 'european')
    expect(c.swing).toBe(0)
    expect(c.z).toBe(0)
  })
})

describe('significance bar', () => {
  it('is the two-sided Bonferroni threshold for the size of the search', () => {
    // A single test at 5% is the familiar 1.96 sigma.
    expect(significanceBar(1)).toBeCloseTo(1.96, 2)
    // 513 combos at 5% each => tested at 0.05/513.
    expect(significanceBar(513)).toBeCloseTo(3.9, 1)
  })

  it('rises with the breadth of the search', () => {
    expect(significanceBar(10)).toBeGreaterThan(significanceBar(1))
    expect(significanceBar(513)).toBeGreaterThan(significanceBar(10))
  })

  it('is stricter the surer you want to be', () => {
    expect(significanceBar(513, 'lenient')).toBeLessThan(significanceBar(513, 'standard'))
    expect(significanceBar(513, 'strict')).toBeGreaterThan(significanceBar(513, 'standard'))
  })

  it('sits above what a fair session’s luckiest combo actually reaches', () => {
    // The best of ~500 pure-noise combos lands near 2.9 sigma; the bar must be
    // clear of that but not so far as to be unreachable in principle.
    const bar = significanceBar(513)
    expect(bar).toBeGreaterThan(3.2)
    expect(bar).toBeLessThan(4.5)
  })

  it('makes a post-hoc shortlist easier to pass, which is why it is opt-in', () => {
    expect(significanceBar(513)).toBeGreaterThan(significanceBar(10))
  })
})

describe('leaderboard lead', () => {
  it('refuses to call a short session meaningful', () => {
    const best = combo({ profit: 200, wins: 5, losses: 2, totalStaked: 100 })
    const verdict = leadIsMeaningful(best, null, 117, 'european')
    expect(verdict.meaningful).toBe(false)
    expect(verdict.reason).toContain('too few')
  })

  it('holds a normal-looking lead to the multiple-comparison bar', () => {
    const best = combo({ profit: 60, wins: 60, losses: 60, totalStaked: 1200, swing: 70 })
    const verdict = leadIsMeaningful(best, null, 117, 'european')
    expect(verdict.meaningful).toBe(false)
    expect(verdict.reason).toContain('chance')
  })

  it('accepts a lead far beyond chance and clear of the runner-up', () => {
    const best = combo({ profit: 4000, wins: 60, losses: 60, totalStaked: 1200, swing: 70 })
    const runnerUp = combo({ profit: 100 })
    expect(leadIsMeaningful(best, runnerUp, 117, 'european').meaningful).toBe(true)
  })

  it('rejects a lead narrower than the session’s own swing', () => {
    const best = combo({ profit: 4000, wins: 60, losses: 60, totalStaked: 1200, swing: 70 })
    const runnerUp = combo({ profit: 3990 })
    const verdict = leadIsMeaningful(best, runnerUp, 117, 'european')
    expect(verdict.meaningful).toBe(false)
    expect(verdict.reason).toContain('closer together')
  })

  it('holds the same result to a higher bar when more combos were searched', () => {
    // Identical session; only the breadth of the search differs. This is the
    // laundering the UI now refuses to do silently.
    // z works out at ~3.2 — clear of the 2.81 bar for ten combos, short of the
    // 3.78 bar for a board of 243.
    const best = combo({ profit: 930, wins: 60, losses: 60, totalStaked: 1200, swing: 300 })
    const runnerUp = combo({ profit: 100 })
    expect(leadIsMeaningful(best, runnerUp, 10, 'european').meaningful).toBe(true)
    expect(leadIsMeaningful(best, runnerUp, 243, 'european').meaningful).toBe(false)
  })

  it('no longer mistakes a wild straight-up run for a real edge', () => {
    // The same $4000 result: convincing for a steady even-money system,
    // ordinary for a straight-up one that swings six times as hard.
    const steady = combo({ profit: 4000, wins: 60, losses: 60, totalStaked: 1200, swing: 300 })
    const wild = combo({ profit: 4000, wins: 60, losses: 60, totalStaked: 1200, swing: 1800 })
    const runnerUp = combo({ profit: 100 })
    expect(leadIsMeaningful(steady, runnerUp, 117, 'european').meaningful).toBe(true)
    expect(leadIsMeaningful(wild, runnerUp, 117, 'european').meaningful).toBe(false)
  })
})
