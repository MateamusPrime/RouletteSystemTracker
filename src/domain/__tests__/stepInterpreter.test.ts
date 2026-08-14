import { describe, expect, it } from 'vitest'
import {
  buildStepPlacementSystem,
  comboLabel,
  comboPayout,
  currentStepState,
  netsByHitCount,
  outcomeKey,
  placedUnits,
  stepOutcomes,
} from '../custom/stepInterpreter'
import type { StepDef, StepPlacementDef } from '../custom/types'
import type { SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 500,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))

function stepSystem(steps: StepDef[]): StepPlacementDef {
  return { variant: 'steps', id: 'test', name: 'Test', description: '', steps }
}

describe('inside bet payouts', () => {
  it('pays the standard odds for each combo size', () => {
    expect(comboPayout(2)).toBe(17) // split
    expect(comboPayout(3)).toBe(11) // street
    expect(comboPayout(4)).toBe(8) // corner
    expect(comboPayout(6)).toBe(5) // six line
  })

  it('names combos by their table names', () => {
    expect(comboLabel([8, 11])).toBe('split 8-11')
    expect(comboLabel([4, 5, 6])).toBe('street 4-5-6')
    expect(comboLabel([5, 6, 8, 9])).toBe('corner 5-6-8-9')
    expect(comboLabel([1, 2, 3, 4, 5, 6])).toBe('six line 1-2-3-4-5-6')
  })
})

describe('outcome enumeration', () => {
  const mixed = stepSystem([
    {
      name: 'Mixed',
      funding: { type: 'fixed' },
      bets: [
        { target: { kind: 'fixed', bet: 'red' }, units: 1 },
        { target: { kind: 'fixed', bet: 'dozen1' }, units: 1 },
      ],
      next: ['restart', 'restart', 'restart'],
    },
  ])

  it('reports net and gross for every reachable outcome', () => {
    const outcomes = stepOutcomes(mixed.steps[0])
    const allMiss = outcomes.find(o => o.hits === 0)!
    expect(allMiss.net).toBe(-2)
    expect(allMiss.gross).toBe(0)

    const bothHit = outcomes.find(o => o.hits === 2)!
    // red pays 1:1 (+1) and dozen 1 pays 2:1 (+2) => net +3, gross 2 + 3 = 5
    expect(bothHit.net).toBe(3)
    expect(bothHit.gross).toBe(5)

    // A single winner is ambiguous: red alone nets 0, dozen 1 alone nets +1.
    const singles = outcomes.filter(o => o.hits === 1)
    expect(singles.map(o => o.net).sort()).toEqual([0, 1])
  })

  it('omits impossible hit counts (mutually exclusive bets)', () => {
    const twoDozens = stepSystem([
      {
        name: 'Two dozens',
        funding: { type: 'fixed' },
        bets: [
          { target: { kind: 'fixed', bet: 'dozen2' }, units: 1 },
          { target: { kind: 'fixed', bet: 'dozen3' }, units: 1 },
        ],
        next: ['restart', 'restart', 'restart'],
      },
    ])
    const counts = [...netsByHitCount(twoDozens.steps[0]).keys()].sort()
    // Two different dozens can never both win, so "2 hits" must not appear.
    expect(counts).toEqual([0, 1])
  })

  it('keys outcomes by winner set regardless of order', () => {
    expect(outcomeKey(['b', 'a'])).toBe(outcomeKey(['a', 'b']))
  })
})

describe('step machine routing', () => {
  const ladder = stepSystem([
    {
      name: 'Base',
      funding: { type: 'fixed' },
      bets: [{ target: { kind: 'fixed', bet: 'red' }, units: 1 }],
      next: ['restart', 1],
    },
    {
      name: 'Climb',
      funding: { type: 'fixed' },
      bets: [{ target: { kind: 'fixed', bet: 'red' }, units: 2 }],
      next: ['restart', 'restart'],
    },
  ])

  it('advances on a win and restarts on a loss', () => {
    expect(currentStepState(ladder, spins([])).stepIdx).toBe(0)
    expect(currentStepState(ladder, spins([1])).stepIdx).toBe(1) // 1 is red
    expect(currentStepState(ladder, spins([2])).stepIdx).toBe(0) // 2 is black
    expect(currentStepState(ladder, spins([1, 2])).stepIdx).toBe(0)
  })

  it('counts a cycle each time it returns to the opening bet', () => {
    // Every loss at Base closes a one-spin cycle.
    expect(currentStepState(ladder, spins([2, 2, 2])).cycles).toBe(3)
    // Win then loss is a single two-spin cycle.
    expect(currentStepState(ladder, spins([1, 2])).cycles).toBe(1)
    // Mid-cycle: sitting on Climb, nothing completed yet.
    expect(currentStepState(ladder, spins([1])).cycles).toBe(0)
  })

  it('routes by exact winner set when an override is present', () => {
    const withOverride = stepSystem([
      {
        name: 'Mixed',
        funding: { type: 'fixed' },
        bets: [
          { target: { kind: 'combo', numbers: [8, 11] }, units: 1 },
          { target: { kind: 'combo', numbers: [5, 6, 8, 9] }, units: 1 },
        ],
        next: ['restart', 'restart', 'restart'],
        outcomeNext: { [outcomeKey(['split 8-11'])]: 1 },
      },
      {
        name: 'Dest',
        funding: { type: 'fixed' },
        bets: [{ target: { kind: 'fixed', bet: 'red' }, units: 1 }],
        next: ['restart', 'restart'],
      },
    ])
    // 11 hits only the split -> override sends it to Dest.
    expect(currentStepState(withOverride, spins([11])).stepIdx).toBe(1)
    // 9 hits only the corner -> falls back to the hit-count rule (restart).
    expect(currentStepState(withOverride, spins([9])).stepIdx).toBe(0)
    // 8 hits both -> two hits, hit-count rule (restart).
    expect(currentStepState(withOverride, spins([8])).stepIdx).toBe(0)
  })
})

describe('carry funding', () => {
  const carrySystem = (basis: 'net' | 'gross', pocketUnits: number) =>
    stepSystem([
      {
        name: 'Base',
        funding: { type: 'fixed' },
        bets: [
          { target: { kind: 'fixed', bet: 'black' }, units: 1 },
          { target: { kind: 'fixed', bet: 'odd' }, units: 1 },
          { target: { kind: 'fixed', bet: 'high' }, units: 1 },
        ],
        next: ['restart', 'restart', 'restart', 1],
      },
      {
        name: 'Spread',
        funding: { type: 'carry', pocketUnits, basis },
        bets: [{ target: { kind: 'numbers', numbers: [1, 5, 9, 14] }, units: 1 }],
        next: ['restart', 'restart'],
      },
    ])

  it('carries net winnings minus the pocketed units', () => {
    // 29 is black, odd and high: all three win. Net +3, gross 6.
    const state = currentStepState(carrySystem('net', 2), spins([29]))
    expect(state.stepIdx).toBe(1)
    expect(state.carryBudget).toBe(1) // 3 net - 2 pocketed
  })

  it('carries the gross return when asked to', () => {
    const state = currentStepState(carrySystem('gross', 2), spins([29]))
    expect(state.carryBudget).toBe(4) // 6 gross - 2 pocketed
  })

  it('restarts when pocketing consumes the whole win', () => {
    const state = currentStepState(carrySystem('net', 10), spins([29]))
    expect(state.stepIdx).toBe(0)
    expect(state.carryBudget).toBeNull()
  })

  it('splits the carried budget across the spread, per number', () => {
    const sys = buildStepPlacementSystem(carrySystem('net', 2))
    const bets = sys.bets({ spins: spins([29]), config })
    expect(bets).toHaveLength(4)
    // 1 unit spread over 4 numbers = 0.25 each, all straight-up at 35:1.
    for (const b of bets) {
      expect(b.units).toBeCloseTo(0.25)
      expect(b.payout).toBe(35)
    }
  })
})

describe('stake accounting', () => {
  it('counts a numbers spread per number, and a combo as one chip', () => {
    const step: StepDef = {
      name: 'S',
      funding: { type: 'fixed' },
      bets: [
        { target: { kind: 'numbers', numbers: [1, 2, 3] }, units: 2 }, // 3 x 2 = 6
        { target: { kind: 'combo', numbers: [4, 5, 6] }, units: 3 }, // one 3u chip
        { target: { kind: 'fixed', bet: 'red' }, units: 1 },
      ],
      next: ['restart', 'restart', 'restart', 'restart'],
    }
    expect(placedUnits(step)).toBe(10)
  })
})

describe('self-managed systems', () => {
  it('declares itself self-managed and reports cycles', () => {
    const sys = buildStepPlacementSystem(
      stepSystem([
        {
          name: 'Base',
          funding: { type: 'fixed' },
          bets: [{ target: { kind: 'fixed', bet: 'red' }, units: 1 }],
          next: ['restart', 'restart'],
        },
      ]),
    )
    expect(sys.selfManaged).toBe(true)
    expect(sys.cycleCount?.({ spins: spins([1, 2, 3]), config })).toBe(3)
  })
})
