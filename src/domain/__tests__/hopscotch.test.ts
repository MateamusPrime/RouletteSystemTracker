import { describe, expect, it } from 'vitest'
import { ALL_HOPSCOTCH_SYSTEMS } from '../placement/hopscotch'
import { ALL_PLACEMENT_SYSTEMS } from '../placement/systems'
import { flat } from '../money/systems'
import { simulateCombo } from '../simulation'
import type { PlacementSystem } from '../placement'
import type { SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 100000,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))
const sys = (id: string) => ALL_HOPSCOTCH_SYSTEMS.find(s => s.id === id)!
const betsAfter = (s: PlacementSystem, ns: number[]) => s.bets({ spins: spins(ns), config })
const units = (s: PlacementSystem, ns: number[]) =>
  betsAfter(s, ns).reduce((t, b) => t + b.units, 0)

// Middle Anchor is the most predictable variant to assert against: the
// even-money leg is always red and the pair is always dozen 2 plus an outer.
const anchor = () => sys('hopscotch-dozens-anchor')

const RED_D1 = 1 // red, dozen 1, column 1
const BLACK_D2 = 20 // black, dozen 2
const RED_D2 = 14 // red, dozen 2

describe('Hopscotch machine', () => {
  it('opens on a single even-money box at one unit', () => {
    const bets = betsAfter(anchor(), [])
    expect(bets).toHaveLength(1)
    expect(bets[0].payout).toBe(1)
    expect(bets[0].units).toBe(1)
  })

  it('hops to the two-group bet after an even-money win, same stake each', () => {
    // 1 is red, so the opening red bet wins.
    const bets = betsAfter(anchor(), [RED_D1])
    expect(bets.every(b => b.payout === 2)).toBe(true)
    expect(bets.every(b => b.units === 1)).toBe(true)
    // Two units on the table now — step 1's stake plus what it just won.
    expect(units(anchor(), [RED_D1])).toBe(2)
  })

  it('hops back to the even-money bet after the pair wins', () => {
    // red win -> pair (dozen 2 + dozen 1); 20 is in dozen 2, so the pair wins.
    const bets = betsAfter(anchor(), [RED_D1, BLACK_D2])
    expect(bets).toHaveLength(1)
    expect(bets[0].payout).toBe(1)
  })

  it('stakes a flat unit throughout, leaving every ladder to the money system', () => {
    // 14 is red AND dozen 2, so it wins at either step: this is an unbroken
    // run of winning round trips, which the old built-in ladder would have
    // ratcheted. The placement layer must stay flat.
    expect(units(anchor(), [])).toBe(1)
    expect(units(anchor(), [RED_D2, RED_D2])).toBe(1)
    expect(units(anchor(), Array(6).fill(RED_D2))).toBe(1)
    expect(units(anchor(), Array(12).fill(RED_D2))).toBe(1)
  })

  it('stakes a flat unit on the pair as well', () => {
    for (const n of [0, 2, 4, 6, 8]) {
      const bets = betsAfter(anchor(), Array(n).fill(RED_D2).concat([RED_D2]))
      for (const b of bets) expect(b.units).toBe(1)
    }
  })

  it('drops to the opening unit on a loss at step 1', () => {
    // 20 is black, so the opening red bet loses.
    const bets = betsAfter(anchor(), [BLACK_D2])
    expect(bets).toHaveLength(1)
    expect(bets[0].payout).toBe(1)
    expect(bets[0].units).toBe(1)
  })

  it('returns to the even-money bet after a loss at step 2', () => {
    // Sit the machine on the pair, then spin a zero — it belongs to no dozen,
    // so the pair loses whichever two it happens to be holding.
    const climb = [RED_D2, RED_D2, RED_D2, RED_D2, RED_D2]
    const afterLoss = betsAfter(anchor(), [...climb, 0])
    expect(afterLoss).toHaveLength(1)
    expect(afterLoss[0].payout).toBe(1)
    expect(afterLoss[0].units).toBe(1)
  })

  it('closes a cycle on every resolved round trip, won or lost', () => {
    const s = anchor()
    const cycles = (ns: number[]) => s.cycleCount!({ spins: spins(ns), config })
    // Mid-trip: the even-money bet won and the pair is still live.
    expect(cycles([RED_D2])).toBe(0)
    // A completed winning round trip closes one.
    expect(cycles([RED_D2, RED_D2])).toBe(1)
    expect(cycles([RED_D2, RED_D2, RED_D2, RED_D2])).toBe(2)
    // Losses close one each, exactly as before.
    expect(cycles([BLACK_D2, BLACK_D2])).toBe(2)
  })

  it('alternates 1:1 → 2:1 → 1:1 → 2:1 for as long as it keeps winning', () => {
    // 14 is red AND dozen 2, so it wins at whichever step the machine is on.
    const steps = Array.from({ length: 8 }, (_, i) =>
      betsAfter(anchor(), Array(i).fill(RED_D2))[0].payout === 1 ? '1:1' : '2:1',
    )
    expect(steps).toEqual(['1:1', '2:1', '1:1', '2:1', '1:1', '2:1', '1:1', '2:1'])
  })

  it('repeats 1:1 only after a loss, never two 2:1 in a row', () => {
    // 0 belongs to no dozen and is not red, so it loses at either step.
    const history: number[] = []
    const seen: { step: string; lost: boolean }[] = []
    for (const n of [0, 0, 0, RED_D2, RED_D2, 0, RED_D2, RED_D2, 0]) {
      const bets = betsAfter(anchor(), [...history])
      const step = bets[0].payout === 1 ? '1:1' : '2:1'
      seen.push({ step, lost: !bets.some(b => b.numbers.includes(n)) })
      history.push(n)
    }
    // Every repeat of 1:1 must be preceded by a loss.
    for (let i = 1; i < seen.length; i++) {
      if (seen[i].step === '1:1' && seen[i - 1].step === '1:1') {
        expect(seen[i - 1].lost).toBe(true)
      }
    }
    // The pair is only ever reached from a winning even-money bet.
    for (let i = 0; i < seen.length; i++) {
      if (seen[i].step === '2:1') {
        expect(seen[i - 1]).toBeDefined()
        expect(seen[i - 1].step).toBe('1:1')
        expect(seen[i - 1].lost).toBe(false)
      }
    }
  })

  it('shows winning trips to the overlay — the point of counting them', () => {
    // The old machine only counted losses, so an overlay could never ratchet
    // up on success. Six winning trips must read as six cycles, not zero.
    const s = anchor()
    expect(s.cycleCount!({ spins: spins(Array(12).fill(RED_D2)), config })).toBe(6)
  })

  it('is self-managed, so flat betting runs it exactly as designed', () => {
    for (const s of ALL_HOPSCOTCH_SYSTEMS) expect(s.selfManaged).toBe(true)
  })
})

describe('Hopscotch leg selection', () => {
  it('Middle Anchor always keeps the middle box and alternates the outer one', () => {
    const pairAt = (ns: number[]) =>
      betsAfter(anchor(), ns)
        .map(b => b.label)
        .sort()
    // First trip: dozen 2 + dozen 1. Second trip: dozen 2 + dozen 3.
    expect(pairAt([RED_D2])).toEqual(['dozen 1', 'dozen 2'])
    expect(pairAt([RED_D2, RED_D2, RED_D2])).toEqual(['dozen 2', 'dozen 3'])
  })

  it('Rotate walks the pairs 1-2, 2-3, 3-1', () => {
    const s = sys('hopscotch-dozens-rotate')
    const pair = (ns: number[]) => betsAfter(s, ns).map(b => b.label).sort()
    // This variant also alternates the colour it backs, so the spins have to
    // alternate too or the even-money leg loses and resets the machine.
    // 14 is red and 20 is black; both sit in dozen 2.
    expect(pair([RED_D2])).toEqual(['dozen 1', 'dozen 2'])
    expect(pair([RED_D2, RED_D2, BLACK_D2])).toEqual(['dozen 2', 'dozen 3'])
    expect(pair([RED_D2, RED_D2, BLACK_D2, BLACK_D2, RED_D2])).toEqual([
      'dozen 1',
      'dozen 3',
    ])
  })

  it('Follow the Last backs the dozen that just hit plus the next one', () => {
    const s = sys('hopscotch-dozens-follow')
    // 1 is red (step 1 wins) and sits in dozen 1, so the pair is 1 and 2.
    expect(betsAfter(s, [RED_D1]).map(b => b.label).sort()).toEqual(['dozen 1', 'dozen 2'])
  })

  it('Cold picks a different pair from Hot on the same history', () => {
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]
    const hot = betsAfter(sys('hopscotch-dozens-hot'), history).map(b => b.label).sort()
    const cold = betsAfter(sys('hopscotch-dozens-cold'), history).map(b => b.label).sort()
    expect(hot).not.toEqual(cold)
  })

  it('the columns family plays columns, not dozens', () => {
    const bets = betsAfter(sys('hopscotch-columns-anchor'), [RED_D2])
    expect(bets.every(b => b.label.startsWith('column'))).toBe(true)
  })

  it('the mixed family plays one dozen and one column', () => {
    const bets = betsAfter(sys('hopscotch-mixed-anchor'), [RED_D2])
    expect(bets).toHaveLength(2)
    expect(bets.filter(b => b.label.startsWith('dozen'))).toHaveLength(1)
    expect(bets.filter(b => b.label.startsWith('column'))).toHaveLength(1)
  })

  it('pays double on a mixed overlap, which is the point of that variant', () => {
    // Dozen 2 and column 2 both contain 14, so a 14 wins both legs.
    const s = sys('hopscotch-mixed-anchor')
    const r = simulateCombo(s, flat, spins([RED_D2, RED_D2]), config, { trace: true })
    const pairSpin = r.trace![1]
    expect(pairSpin.bets).toHaveLength(2)
    expect(pairSpin.bets.every(b => b.won)).toBe(true)
    // Staked 2 units ($10), both legs pay 2:1, so the net is 4 units ($20).
    expect(pairSpin.staked).toBe(10)
    expect(pairSpin.net).toBe(20)
  })
})

describe('the Hopscotch set as a whole', () => {
  it('offers every mode across every group family', () => {
    expect(ALL_HOPSCOTCH_SYSTEMS).toHaveLength(15)
    const ids = ALL_HOPSCOTCH_SYSTEMS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of ['dozens', 'columns', 'mixed']) {
      for (const m of ['hot', 'cold', 'follow', 'anchor', 'rotate']) {
        expect(ids).toContain(`hopscotch-${g}-${m}`)
      }
    }
  })

  it('is registered in the main placement list', () => {
    const all = new Set(ALL_PLACEMENT_SYSTEMS.map(s => s.id))
    for (const s of ALL_HOPSCOTCH_SYSTEMS) expect(all.has(s.id)).toBe(true)
  })

  it('never stakes the same box twice on one spin', () => {
    for (const s of ALL_HOPSCOTCH_SYSTEMS) {
      for (const ns of [[], [0], [RED_D2], [RED_D2, RED_D2], [0, 0, 0], [1, 20, 30, 14]]) {
        const labels = betsAfter(s, ns).map(b => b.label)
        expect(new Set(labels).size).toBe(labels.length)
      }
    }
  })

  it('survives a zero at every step without misbehaving', () => {
    for (const s of ALL_HOPSCOTCH_SYSTEMS) {
      const r = simulateCombo(s, flat, spins([0, 0, RED_D2, 0, RED_D2, RED_D2, 0]), config)
      expect(Number.isFinite(r.profit)).toBe(true)
      expect(r.ruinedAt).toBeNull()
    }
  })

  it('replays identically whether walked incrementally or in one go', () => {
    // The replay is cached against the growing array the simulation reuses, so
    // a fresh call on the same history must land on the same bets.
    const history = [1, 20, 14, 14, 30, 5, 14, 0, 14, 14]
    for (const s of ALL_HOPSCOTCH_SYSTEMS) {
      const incremental: number[] = []
      for (let i = 0; i <= history.length; i++) {
        incremental.push(units(s, history.slice(0, i)))
      }
      // Re-derive from scratch with fresh arrays in reverse order, which cannot
      // benefit from the cache, and compare.
      const fresh: number[] = []
      for (let i = history.length; i >= 0; i--) {
        fresh[i] = units(s, [...history.slice(0, i)])
      }
      expect(fresh).toEqual(incremental)
    }
  })
})
