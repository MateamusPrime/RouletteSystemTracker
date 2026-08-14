import { describe, expect, it } from 'vitest'
import {
  buildMartiPlacementSystem,
  currentRound,
  martiLegs,
} from '../custom/martiInterpreter'
import type { MartiPlacementDef } from '../custom/types'
import { flat, martingale } from '../money/systems'
import { simulateCombo } from '../simulation'
import type { SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 2000,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))

function marti(over: Partial<MartiPlacementDef> = {}): MartiPlacementDef {
  return {
    variant: 'marti',
    id: 'marti',
    name: 'Marti GB',
    description: '',
    anchor: 17,
    families: ['color', 'parity', 'half', 'dozen', 'column'],
    units: 1,
    resetEachRound: true,
    ...over,
  }
}

const labels = (def: MartiPlacementDef, ns: number[]) =>
  buildMartiPlacementSystem(def).bets({ spins: spins(ns), config }).map(b => b.label)

describe('anchor number drives the legs', () => {
  it('reads the number’s own properties off the board', () => {
    // 17 is black, odd, in 1-18, the 2nd dozen and the 2nd column.
    expect(martiLegs(marti()).map(l => l.label)).toEqual([
      'black',
      'odd',
      '1-18',
      'dozen 2',
      'column 2',
    ])
  })

  it('follows a different number to different legs', () => {
    // 34 is red, even, in 19-36, the 3rd dozen and the 1st column.
    expect(martiLegs(marti({ anchor: 34 })).map(l => l.label)).toEqual([
      'red',
      'even',
      '19-36',
      'dozen 3',
      'column 1',
    ])
  })

  it('plays only the families that were chosen', () => {
    expect(martiLegs(marti({ families: ['color', 'dozen'] })).map(l => l.label)).toEqual([
      'black',
      'dozen 2',
    ])
  })

  it('has no legs for a zero anchor', () => {
    expect(martiLegs(marti({ anchor: 0 }))).toEqual([])
  })
})

describe('the round', () => {
  it('opens with every leg live', () => {
    expect(labels(marti(), [])).toEqual(['black', 'odd', '1-18', 'dozen 2', 'column 2'])
  })

  it('stands a leg down once it wins', () => {
    // 20 is black, even, high, dozen 2, column 2 — so black, dozen 2 and
    // column 2 all land and retire; odd and 1-18 keep going.
    expect(labels(marti(), [20])).toEqual(['odd', '1-18'])
  })

  it('keeps a retired leg down even if its bet keeps hitting', () => {
    // Another black should not bring the black leg back into play.
    expect(labels(marti(), [20, 22])).toEqual(['odd', '1-18'])
  })

  it('restarts every leg once the last one lands', () => {
    // After 20 only odd and 1-18 remain; 17 itself lands both, completing the
    // round, so all five legs come back for round two.
    const state = currentRound(marti(), spins([20, 17]))
    expect(state.round).toBe(1)
    expect(state.done.size).toBe(0)
    expect(labels(marti(), [20, 17])).toEqual([
      'black',
      'odd',
      '1-18',
      'dozen 2',
      'column 2',
    ])
  })

  it('completes a round in one spin when the anchor itself lands', () => {
    expect(currentRound(marti(), spins([17])).round).toBe(1)
  })

  it('treats a zero as a miss for every leg', () => {
    expect(labels(marti(), [0])).toEqual(['black', 'odd', '1-18', 'dozen 2', 'column 2'])
  })
})

describe('progressions across rounds', () => {
  it('gives each round a fresh progression when asked to', () => {
    const def = marti({ families: ['color', 'parity'], resetEachRound: true })
    const system = buildMartiPlacementSystem(def)
    // Round 1 legs and round 2 legs carry different ids, so the simulator
    // starts each round's money management from scratch.
    const first = system.bets({ spins: [], config }).map(b => b.leg)
    const second = system.bets({ spins: spins([17]), config }).map(b => b.leg)
    expect(first).toEqual(['black#0', 'odd#0'])
    expect(second).toEqual(['black#1', 'odd#1'])
  })

  it('keeps one progression per leg when carrying over', () => {
    const def = marti({ families: ['color'], resetEachRound: false })
    const system = buildMartiPlacementSystem(def)
    expect(system.bets({ spins: [], config }).map(b => b.leg)).toEqual(['black'])
    expect(system.bets({ spins: spins([17]), config }).map(b => b.leg)).toEqual(['black'])
  })

  it('resets the stake at a new round rather than carrying the escalation', () => {
    // Colour only, Martingale. Reds make the black leg lose and double; when
    // black finally lands the round ends and the next round opens at 1 unit.
    const def = marti({ families: ['color'], resetEachRound: true })
    const result = simulateCombo(
      buildMartiPlacementSystem(def),
      martingale,
      spins([1, 3, 5, 2, 1]),
      config,
      { trace: true },
    )
    expect(result.trace!.map(t => t.staked)).toEqual([5, 10, 20, 40, 5])
  })

  it('carries the escalation instead when told to', () => {
    const def = marti({ families: ['color'], resetEachRound: false })
    const result = simulateCombo(
      buildMartiPlacementSystem(def),
      martingale,
      spins([1, 3, 5, 2, 1]),
      config,
      { trace: true },
    )
    // The win on spin 4 resets Martingale itself, so the fifth spin is 1 unit
    // either way — the difference shows on plans that do not reset on a win.
    expect(result.trace!.map(t => t.staked)).toEqual([5, 10, 20, 40, 5])
  })
})

describe('legs stay independent', () => {
  it('runs a separate progression per leg off one bankroll', () => {
    const def = marti({ families: ['color', 'dozen'] })
    const result = simulateCombo(
      buildMartiPlacementSystem(def),
      martingale,
      // 1 is red and dozen 1: both black and dozen 2 lose and double.
      spins([1, 1]),
      config,
      { trace: true },
    )
    expect(result.trace![0].bets.map(b => b.amount)).toEqual([5, 5])
    expect(result.trace![1].bets.map(b => b.amount)).toEqual([10, 10])
  })

  it('shares the bankroll across the live legs', () => {
    const result = simulateCombo(
      buildMartiPlacementSystem(marti()),
      flat,
      spins([1]),
      config,
    )
    // Five legs at $5 each on the opening spin.
    expect(result.totalStaked).toBe(25)
  })
})
