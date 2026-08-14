import { describe, expect, it } from 'vitest'
import { bandsForTrace, contiguousBands } from '../timelineBands'
import type { TraceEntry } from '../simulation'

function entry(over: Partial<TraceEntry> = {}): TraceEntry {
  return {
    index: 0,
    n: 1,
    bets: [],
    staked: 0,
    net: 0,
    bankroll: 100,
    outcome: 'win',
    violations: [],
    ...over,
  }
}

describe('contiguous bands', () => {
  it('merges a run of spins into one region', () => {
    // Spins 3,4,5 (0-based 2,3,4) match.
    const bands = contiguousBands(8, i => i >= 2 && i <= 4, 'capped', 'capped')
    expect(bands).toEqual([{ kind: 'capped', label: 'capped', from: 3, to: 5 }])
  })

  it('keeps separate runs separate', () => {
    const bands = contiguousBands(10, i => i === 1 || i === 5 || i === 6, 'capped', 'c')
    expect(bands.map(b => [b.from, b.to])).toEqual([
      [2, 2],
      [6, 7],
    ])
  })

  it('closes a run that reaches the end', () => {
    const bands = contiguousBands(5, i => i >= 3, 'capped', 'c')
    expect(bands).toEqual([{ kind: 'capped', label: 'c', from: 4, to: 5 }])
  })

  it('returns nothing when nothing matches', () => {
    expect(contiguousBands(5, () => false, 'capped', 'c')).toEqual([])
  })
})

describe('bands for a combo trace', () => {
  it('shades the spins whose bets were cut down to the table maximum', () => {
    const trace = [
      entry(),
      entry({ bets: [{ label: 'red', numbers: [1], payout: 1, amount: 500, requested: 640, won: false }] }),
      entry({ caps: ['red cut to $500'] }),
      entry(),
    ]
    const capped = bandsForTrace(trace, null).filter(b => b.kind === 'capped')
    // Both spins are cut and adjacent, so they form one region.
    expect(capped).toEqual([{ kind: 'capped', label: 'cut to table max', from: 2, to: 3 }])
  })

  it('shades a bet lifted to the minimum as its own kind, not as a cut', () => {
    const trace = [
      entry(),
      // Placed ABOVE what was wanted — the table minimum pushed it up.
      entry({ bets: [{ label: 'red', numbers: [1], payout: 1, amount: 5, requested: 1, won: false }] }),
      entry({ raises: ['red lifted to $5'] }),
      entry(),
    ]
    const bands = bandsForTrace(trace, null)
    expect(bands.filter(b => b.kind === 'capped')).toEqual([])
    expect(bands.filter(b => b.kind === 'raised')).toEqual([
      { kind: 'raised', label: 'lifted to table min', from: 2, to: 3 },
    ])
  })

  it('shades spins the bankroll could not cover', () => {
    const trace = [
      entry(),
      entry({ violations: ['needs $185.00 but only $95.00 left — bet not placed'] }),
      entry(),
    ]
    const bands = bandsForTrace(trace, null).filter(b => b.kind === 'unaffordable')
    expect(bands).toEqual([{ kind: 'unaffordable', label: 'could not cover', from: 2, to: 2 }])
  })

  it('shades everything after the money ran out as one dead region', () => {
    const trace = [entry(), entry(), entry(), entry(), entry()]
    const bands = bandsForTrace(trace, 3).filter(b => b.kind === 'ruined')
    expect(bands).toEqual([{ kind: 'ruined', label: 'out of money', from: 3, to: 5 }])
  })

  it('prefers ruin over a guardrail stop when both are set', () => {
    const trace = [entry(), entry(), entry()]
    const kinds = bandsForTrace(trace, 2, 3).map(b => b.kind)
    expect(kinds).toContain('ruined')
    expect(kinds).not.toContain('stopped')
  })

  it('shades a guardrail walk-away', () => {
    const trace = [entry(), entry(), entry(), entry()]
    const bands = bandsForTrace(trace, null, 2).filter(b => b.kind === 'stopped')
    expect(bands).toEqual([{ kind: 'stopped', label: 'walked away', from: 2, to: 4 }])
  })

  it('produces nothing for a clean session', () => {
    expect(bandsForTrace([entry(), entry()], null)).toEqual([])
  })
})
