import { describe, expect, it } from 'vitest'
import { computeStats } from '../stats'
import type { Spin } from '../types'

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))

describe('session stats', () => {
  it('splits colors, parity, halves, dozens and columns', () => {
    // 1 red/odd/low/d1/c1, 2 black/even/low/d1/c2, 0 green.
    const s = computeStats(spins([1, 2, 0]), 'european')
    expect(s.total).toBe(3)
    expect(s.colors.find(c => c.label === 'Red')!.count).toBe(1)
    expect(s.colors.find(c => c.label === 'Black')!.count).toBe(1)
    expect(s.colors.find(c => c.label === 'Green')!.count).toBe(1)
    expect(s.oddEven.find(c => c.label === 'Odd')!.count).toBe(1)
    expect(s.highLow.find(c => c.label === '1-18')!.count).toBe(2)
    expect(s.dozens.find(c => c.label === '1st 12')!.count).toBe(2)
    expect(s.zeros).toBe(1)
  })

  it('counts back-to-back repeats', () => {
    expect(computeStats(spins([5, 5, 5, 9]), 'european').repeatCount).toBe(2)
    expect(computeStats(spins([5, 9, 5]), 'european').repeatCount).toBe(0)
  })

  it('tracks the current and longest color streaks, ignoring green', () => {
    // 1,3,5 red (streak 3), 2 black, 4 black.
    const s = computeStats(spins([1, 3, 5, 2, 4]), 'european')
    expect(s.longestColorStreak).toEqual({ color: 'red', length: 3 })
    expect(s.currentColorStreak).toEqual({ color: 'black', length: 2 })
  })

  it('ranks hot numbers and reports sleeper gaps', () => {
    const s = computeStats(spins([7, 7, 7, 12, 12, 3]), 'european')
    expect(s.hot[0]).toMatchObject({ n: 7, count: 3 })
    // 7 last landed three spins before the end.
    expect(s.hot.find(h => h.n === 7)!.gap).toBe(3)
    // Numbers that never landed have an infinite gap.
    const sleeper = s.sleepers[0]
    expect(sleeper.gap).toBe(Infinity)
  })

  it('reports zero chi-squared for a perfectly uniform sample', () => {
    // One of every European pocket: exactly the expected distribution.
    const every = Array.from({ length: 37 }, (_, i) => i)
    expect(computeStats(spins(every), 'european').chiSquared).toBeCloseTo(0)
  })

  it('handles an empty session', () => {
    const s = computeStats([], 'european')
    expect(s.total).toBe(0)
    expect(s.chiSquared).toBe(0)
    expect(s.colors.every(c => c.pct === 0)).toBe(true)
  })
})

describe('reading the chi-squared', () => {
  it('refuses to judge a sample too small to mean anything', () => {
    const s = computeStats(spins([1, 2, 3, 4, 5]), 'european')
    expect(s.chi.reliable).toBe(false)
    expect(s.chi.spinsNeeded).toBeGreaterThan(0)
    expect(s.chi.verdict).toContain('more spins')
  })

  it('needs five expected hits per pocket before it will judge', () => {
    const many = Array.from({ length: 37 * 5 }, (_, i) => i % 37)
    const s = computeStats(spins(many), 'european')
    expect(s.chi.reliable).toBe(true)
    expect(s.chi.expectedPerPocket).toBeCloseTo(5, 6)
  })

  it('calls a dead-even wheel normal, not suspicious', () => {
    // Five of every pocket: chi-squared is 0, which is BELOW the ~36 a fair
    // wheel averages. It must not read as a bias.
    const even = Array.from({ length: 37 * 5 }, (_, i) => i % 37)
    const s = computeStats(spins(even), 'european')
    expect(s.chiSquared).toBeCloseTo(0)
    expect(s.chi.z).toBeLessThan(0)
    expect(s.chi.verdict).toBe('normal for a fair wheel')
  })

  it('flags a wheel where one pocket dominates', () => {
    // Half the spins on a single number is a wheel nobody would call fair.
    const rigged = [
      ...Array.from({ length: 200 }, () => 17),
      ...Array.from({ length: 200 }, (_, i) => i % 37),
    ]
    const s = computeStats(spins(rigged), 'european')
    expect(s.chi.reliable).toBe(true)
    expect(s.chi.z).toBeGreaterThan(3.5)
    expect(s.chi.verdict).toContain('very uneven')
  })

  it('reports the degrees of freedom a fair wheel averages', () => {
    const s = computeStats(spins(Array.from({ length: 200 }, (_, i) => i % 37)), 'european')
    expect(s.chi.df).toBe(36)
    const american = computeStats(
      spins(Array.from({ length: 200 }, (_, i) => i % 38)),
      'american',
    )
    expect(american.chi.df).toBe(37)
  })
})
