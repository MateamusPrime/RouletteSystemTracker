import { describe, expect, it } from 'vitest'
import { histogram, runMonteCarlo } from '../monteCarlo'
import { flat, martingale } from '../money/systems'
import { alwaysRed } from '../placement/systems'
import type { SessionConfig } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 1000,
  baseUnit: 5,
}

describe('monte carlo batches', () => {
  it('is reproducible for a given seed', async () => {
    const opts = { runs: 30, spinsPerRun: 40, seed: 42, config }
    const a = await runMonteCarlo(alwaysRed, flat, opts)
    const b = await runMonteCarlo(alwaysRed, flat, opts)
    expect(a.profits).toEqual(b.profits)
    expect(a.mean).toBe(b.mean)
  })

  it('produces different batches for different seeds', async () => {
    const a = await runMonteCarlo(alwaysRed, flat, { runs: 30, spinsPerRun: 40, seed: 1, config })
    const b = await runMonteCarlo(alwaysRed, flat, { runs: 30, spinsPerRun: 40, seed: 2, config })
    expect(a.profits).not.toEqual(b.profits)
  })

  it('lands near the house edge over a long batch of flat bets', async () => {
    const r = await runMonteCarlo(alwaysRed, flat, {
      runs: 300,
      spinsPerRun: 200,
      seed: 7,
      config,
    })
    // The mean result should sit within a reasonable band of the expectation.
    const perRunSwing = 5 * Math.sqrt(200) // stake x sqrt(spins)
    const tolerance = (3 * perRunSwing) / Math.sqrt(300)
    expect(Math.abs(r.mean - r.expectedProfit)).toBeLessThan(tolerance)
    expect(r.expectedProfit).toBeLessThan(0)
  })

  it('orders the percentile summary correctly', async () => {
    const r = await runMonteCarlo(alwaysRed, flat, {
      runs: 100,
      spinsPerRun: 60,
      seed: 3,
      config,
    })
    expect(r.worst).toBeLessThanOrEqual(r.p5)
    expect(r.p5).toBeLessThanOrEqual(r.p25)
    expect(r.p25).toBeLessThanOrEqual(r.median)
    expect(r.median).toBeLessThanOrEqual(r.p75)
    expect(r.p75).toBeLessThanOrEqual(r.p95)
    expect(r.p95).toBeLessThanOrEqual(r.best)
    expect(r.runs).toBe(100)
  })

  it('exposes the ruin a doubling progression earns on a short bankroll', async () => {
    const smallRoll: SessionConfig = { ...config, startingBankroll: 100 }
    const r = await runMonteCarlo(alwaysRed, martingale, {
      runs: 100,
      spinsPerRun: 150,
      seed: 11,
      config: smallRoll,
    })
    // With only 20 units behind it, the doubling almost always outgrows the
    // bankroll before the session ends — that is the whole point.
    expect(r.ruinRate).toBeGreaterThan(0.5)
    expect(r.winRate).toBeLessThan(1)
  })

  it('reports progress and finishes at 100%', async () => {
    const seen: number[] = []
    const r = await runMonteCarlo(
      alwaysRed,
      flat,
      { runs: 60, spinsPerRun: 20, seed: 5, config },
      done => seen.push(done),
    )
    expect(seen[seen.length - 1]).toBe(r.runs)
  })
})

describe('histogram', () => {
  it('buckets values and keeps every observation', () => {
    const bins = histogram([-100, -50, 0, 50, 100], 5)
    expect(bins).toHaveLength(5)
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(5)
  })

  it('collapses to a single bucket when every run tied', () => {
    expect(histogram([10, 10, 10])).toEqual([{ x: 10, count: 3 }])
  })

  it('handles an empty batch', () => {
    expect(histogram([])).toEqual([])
  })
})
