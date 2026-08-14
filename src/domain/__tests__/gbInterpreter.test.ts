import { describe, expect, it } from 'vitest'
import { buildGbPlacementSystem, describeTrigger } from '../custom/gbInterpreter'
import type { GbLegDef, GbPlacementDef } from '../custom/types'
import { flat, martingale } from '../money/systems'
import { simulateCombo } from '../simulation'
import type { SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 1000,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))

function gb(legs: GbLegDef[]): GbPlacementDef {
  return { variant: 'gb', id: 'gb', name: 'GB', description: '', legs }
}

const labels = (def: GbPlacementDef, ns: number[]) =>
  buildGbPlacementSystem(def).bets({ spins: spins(ns), config }).map(b => b.label)

describe('GB triggers', () => {
  it('bets every spin when the trigger is always', () => {
    const def = gb([{ bet: 'red', units: 1, trigger: { kind: 'always' } }])
    expect(labels(def, [])).toEqual(['red'])
    expect(labels(def, [2])).toEqual(['red'])
  })

  it('waits for a leg to sleep the requested number of spins', () => {
    const def = gb([{ bet: 'red', units: 1, trigger: { kind: 'asleep', spins: 3 } }])
    expect(labels(def, [2, 4])).toEqual([]) // only two blacks so far
    expect(labels(def, [2, 4, 6])).toEqual(['red'])
    expect(labels(def, [2, 4, 6, 1])).toEqual([]) // red landed; back to sleep
  })

  it('counts a zero as a miss, deepening the sleep', () => {
    const def = gb([{ bet: 'red', units: 1, trigger: { kind: 'asleep', spins: 3 } }])
    expect(labels(def, [2, 4, 0])).toEqual(['red'])
  })

  it('fires a hot trigger once the leg has hit often enough', () => {
    const def = gb([{ bet: 'red', units: 1, trigger: { kind: 'hot', window: 4, times: 3 } }])
    expect(labels(def, [1, 3, 2, 4])).toEqual([]) // only two reds in the window
    expect(labels(def, [1, 3, 5, 2])).toEqual(['red']) // three reds in the last four
  })

  it('describes each trigger for the hover card', () => {
    expect(describeTrigger({ kind: 'always' })).toBe('every spin')
    expect(describeTrigger({ kind: 'asleep', spins: 5 })).toBe('asleep 5+')
    expect(describeTrigger({ kind: 'hot', window: 12, times: 5 })).toBe('5+ in 12')
  })
})

describe('GB legs', () => {
  const twoLegs = gb([
    { bet: 'red', units: 1, trigger: { kind: 'always' } },
    { bet: 'dozen1', units: 2, trigger: { kind: 'always' } },
  ])

  it('tags every bet with its own leg id', () => {
    const bets = buildGbPlacementSystem(twoLegs).bets({ spins: [], config })
    expect(bets.map(b => b.leg)).toEqual(['red', 'dozen 1'])
    expect(bets.map(b => b.payout)).toEqual([1, 2])
    expect(bets.map(b => b.units)).toEqual([1, 2])
  })

  it('runs each leg on its own progression off one bankroll', () => {
    // 20 is black and in dozen 2, so both legs lose and both double.
    // 3 is red and in dozen 1, so both win and both reset.
    const result = simulateCombo(
      buildGbPlacementSystem(twoLegs),
      martingale,
      spins([20, 20, 3]),
      config,
      { trace: true },
    )
    const staked = result.trace!.map(t => t.bets.map(b => b.amount))
    expect(staked[0]).toEqual([5, 10]) // opening stakes: 1u and 2u
    expect(staked[1]).toEqual([10, 20]) // both legs doubled
    expect(staked[2]).toEqual([20, 40]) // and doubled again
  })

  it('lets one leg reset while another keeps climbing', () => {
    // 25 is red (red wins, resets) and in dozen 3 (dozen 1 loses, doubles).
    const result = simulateCombo(
      buildGbPlacementSystem(twoLegs),
      martingale,
      spins([20, 25, 25]),
      config,
      { trace: true },
    )
    const staked = result.trace!.map(t => t.bets.map(b => b.amount))
    expect(staked[1]).toEqual([10, 20]) // both lost on 20
    expect(staked[2]).toEqual([5, 40]) // red reset, dozen 1 doubled again
  })

  it('shares one bankroll across the legs', () => {
    const result = simulateCombo(buildGbPlacementSystem(twoLegs), flat, spins([20]), config)
    expect(result.totalStaked).toBe(15) // $5 + $10 in one spin
    expect(result.profit).toBe(-15)
  })
})

describe('inside-bet legs', () => {
  it('plays a single pocket straight up at 35:1', () => {
    const def = gb([
      { target: { kind: 'combo', numbers: [17] }, units: 1, trigger: { kind: 'always' } },
    ])
    const [bet] = buildGbPlacementSystem(def).bets({ spins: [], config })
    expect(bet.label).toBe('straight up 17')
    expect(bet.payout).toBe(35)
    expect(bet.numbers).toEqual([17])
  })

  it('prices splits, streets, corners and six lines from their coverage', () => {
    const def = gb([
      { target: { kind: 'combo', numbers: [8, 11] }, units: 1, trigger: { kind: 'always' } },
      { target: { kind: 'combo', numbers: [4, 5, 6] }, units: 1, trigger: { kind: 'always' } },
      { target: { kind: 'combo', numbers: [5, 6, 8, 9] }, units: 1, trigger: { kind: 'always' } },
      {
        target: { kind: 'combo', numbers: [1, 2, 3, 4, 5, 6] },
        units: 1,
        trigger: { kind: 'always' },
      },
    ])
    const bets = buildGbPlacementSystem(def).bets({ spins: [], config })
    expect(bets.map(b => b.payout)).toEqual([17, 11, 8, 5])
    // Each keeps its own progression key.
    expect(new Set(bets.map(b => b.leg)).size).toBe(4)
  })

  it('sleeps an inside leg on its own coverage', () => {
    const def = gb([
      { target: { kind: 'combo', numbers: [4, 5, 6] }, units: 1, trigger: { kind: 'asleep', spins: 2 } },
    ])
    expect(labels(def, [1, 2])).toEqual(['street 4-5-6'])
    expect(labels(def, [1, 5])).toEqual([]) // the street just landed
  })

  it('still understands legs saved in the older outside-only shape', () => {
    const legacy = gb([{ bet: 'red', units: 1, trigger: { kind: 'always' } }])
    const [bet] = buildGbPlacementSystem(legacy).bets({ spins: [], config })
    expect(bet.label).toBe('red')
    expect(bet.payout).toBe(1)
  })
})

describe('GB summaries', () => {
  it('reports each leg with its trigger and stake', () => {
    const system = buildGbPlacementSystem(
      gb([
        { bet: 'red', units: 1, trigger: { kind: 'asleep', spins: 5 } },
        { bet: 'dozen2', units: 2, trigger: { kind: 'hot', window: 10, times: 4 } },
      ]),
    )
    expect(system.summary?.badge).toContain('2 independent legs')
    expect(system.summary?.facts).toEqual([
      { label: 'red', value: 'asleep 5+ · 1u' },
      { label: 'dozen 2', value: '4+ in 10 · 2u' },
    ])
    expect(system.summary?.note).toContain('same bankroll')
  })
})
