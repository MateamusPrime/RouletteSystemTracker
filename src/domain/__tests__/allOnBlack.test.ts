import { describe, expect, it } from 'vitest'
import {
  ALL_ON_BLACK_SYSTEMS,
  aobCentipede,
  aobChaosFtl,
  aobChaosFtw,
  aobCya,
  aobCyaScouse,
  aobFiveDoubleStreets,
  aobGoalposts,
  aobMillipede,
  aobNineStreets123,
  aobPlague,
  aobScouser,
  aobSlut,
} from '../placement/allOnBlack'
import { threeThenTwoRecovery } from '../money/systems'
import { ALL_PLACEMENT_SYSTEMS } from '../placement/systems'
import type { PlacementSystem } from '../placement'
import type { SessionConfig, Spin, SpinOutcome } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 1000,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))
const betsOf = (s: PlacementSystem, ns: number[] = []) => s.bets({ spins: spins(ns), config })
/** Every number the layout covers, deduplicated and sorted. */
const covers = (s: PlacementSystem, ns: number[] = []) =>
  [...new Set(betsOf(s, ns).flatMap(b => b.numbers))].sort((a, b) => a - b)
const units = (s: PlacementSystem, ns: number[] = []) =>
  betsOf(s, ns).reduce((t, b) => t + b.units, 0)
/** Numbers NOT covered — the channel calls these the "whacks". */
const whacks = (s: PlacementSystem, ns: number[] = []) => {
  const c = new Set(covers(s, ns))
  return Array.from({ length: 37 }, (_, i) => i).filter(n => !c.has(n))
}

describe('5 Double Streets', () => {
  it('covers five of the six double streets for five units', () => {
    expect(betsOf(aobFiveDoubleStreets)).toHaveLength(5)
    expect(units(aobFiveDoubleStreets)).toBe(5)
    expect(whacks(aobFiveDoubleStreets)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('pays 5:1 on every double street', () => {
    for (const b of betsOf(aobFiveDoubleStreets)) {
      expect(b.payout).toBe(5)
      expect(b.numbers).toHaveLength(6)
    }
  })

  it('Goalposts leaves both ends of the board open', () => {
    // The channel states the whacks explicitly, so this is a direct check.
    expect(whacks(aobGoalposts)).toEqual([0, 1, 2, 3, 34, 35, 36])
    expect(units(aobGoalposts)).toBe(5)
  })

  it('Slut marches the open double street right on every spin', () => {
    // Spin 1 leaves 1-6 open, spin 2 leaves 7-12, and so on.
    expect(whacks(aobSlut, [])).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(whacks(aobSlut, [17])).toEqual([0, 7, 8, 9, 10, 11, 12])
    expect(whacks(aobSlut, [17, 17])).toEqual([0, 13, 14, 15, 16, 17, 18])
    // Six spins in it wraps back to the start.
    expect(whacks(aobSlut, [1, 1, 1, 1, 1, 1])).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('Slut rotates on the result-independent spin count, not on wins', () => {
    // Same number of spins, wildly different outcomes: same layout.
    expect(whacks(aobSlut, [1, 2, 3])).toEqual(whacks(aobSlut, [30, 31, 32]))
  })

  it('Plague leaves the double street that just hit open', () => {
    // The channel's own two examples.
    expect(whacks(aobPlague, [12])).toEqual([0, 7, 8, 9, 10, 11, 12])
    expect(whacks(aobPlague, [28])).toEqual([0, 25, 26, 27, 28, 29, 30])
  })

  it('Plague holds a five-unit stake when a zero hits', () => {
    // No double street contains the zero, so the stake must not jump to six.
    expect(units(aobPlague, [0])).toBe(5)
  })
})

describe('9 Streets', () => {
  it('covers the streets the channel names for slots 1,2,3', () => {
    // 1,4,7 in the first dozen; 13,16,19 in the second; 25,28,31 in the third.
    const starts = betsOf(aobNineStreets123).map(b => b.numbers[0])
    expect(starts).toEqual([1, 4, 7, 13, 16, 19, 25, 28, 31])
    expect(units(aobNineStreets123)).toBe(9)
  })

  it('covers 27 numbers, which is where the 3 units of profit come from', () => {
    expect(covers(aobNineStreets123)).toHaveLength(27)
    for (const b of betsOf(aobNineStreets123)) expect(b.payout).toBe(11)
  })

  it('Centipede covers nine consecutive streets, 7 through 33', () => {
    const starts = betsOf(aobCentipede).map(b => b.numbers[0])
    expect(starts).toEqual([7, 10, 13, 16, 19, 22, 25, 28, 31])
    expect(covers(aobCentipede)).toEqual(
      Array.from({ length: 27 }, (_, i) => i + 7),
    )
  })

  it('offers all four dozen-slot formats', () => {
    const ids = ALL_ON_BLACK_SYSTEMS.filter(s => s.id.startsWith('aob-9-streets')).map(s => s.id)
    expect(ids).toEqual([
      'aob-9-streets-123',
      'aob-9-streets-124',
      'aob-9-streets-134',
      'aob-9-streets-234',
    ])
  })
})

describe('Millipede', () => {
  it('stakes 9 streets at 2u and 8 double streets at 1u — 26 units', () => {
    const bets = betsOf(aobMillipede)
    const streets = bets.filter(b => b.payout === 11)
    const doubles = bets.filter(b => b.payout === 5)
    expect(streets).toHaveLength(9)
    expect(doubles).toHaveLength(8)
    expect(streets.every(b => b.units === 2)).toBe(true)
    expect(doubles.every(b => b.units === 1)).toBe(true)
    expect(units(aobMillipede)).toBe(26)
  })

  it('covers 7 through 33 and leaves the ends thin', () => {
    expect(covers(aobMillipede)).toEqual(Array.from({ length: 27 }, (_, i) => i + 7))
  })

  it('stacks the middle harder than the edges, which is the whole idea', () => {
    // Total units riding on a number, for a "banger" versus the worst street.
    const load = (n: number) =>
      betsOf(aobMillipede)
        .filter(b => b.numbers.includes(n))
        .reduce((t, b) => t + b.units, 0)
    expect(load(19)).toBeGreaterThan(load(7))
    expect(load(19)).toBeGreaterThan(load(33))
  })
})

describe('CYA', () => {
  it('places nine overlapping corners plus the open column', () => {
    const bets = betsOf(aobCya)
    const corners = bets.filter(b => b.payout === 8)
    const column = bets.filter(b => b.payout === 2)
    expect(corners).toHaveLength(9)
    expect(column).toHaveLength(1)
    expect(column[0].units).toBe(5)
    // Corners genuinely overlap: 9 corners x 4 numbers would be 36 if not.
    expect(covers(aobCya).length).toBeLessThan(36)
  })

  it('builds each corner as a 2x2 block named by its lowest number', () => {
    const first = betsOf(aobCya).find(b => b.payout === 8)!
    expect(first.numbers).toEqual([1, 2, 4, 5])
  })

  it('the Scouse variation raises the column stake to six', () => {
    const column = betsOf(aobCyaScouse).find(b => b.payout === 2)!
    expect(column.units).toBe(6)
    expect(units(aobCyaScouse)).toBe(units(aobCya) + 1)
  })
})

describe('Scouser', () => {
  it('matches the published layout exactly', () => {
    const bets = betsOf(aobScouser)
    const split = bets.find(b => b.payout === 17)!
    expect(split.numbers).toEqual([0, 2])
    expect(split.units).toBe(2)

    const streets = bets.filter(b => b.payout === 11)
    expect(streets.map(b => b.numbers[0])).toEqual([10, 19, 28])
    expect(streets.every(b => b.units === 2)).toBe(true)

    const corners = bets.filter(b => b.payout === 8)
    expect(corners.map(b => b.numbers[0])).toEqual([5, 13, 23, 31])
    expect(corners.every(b => b.units === 3)).toBe(true)
  })

  it('totals the 20 units the channel quotes', () => {
    expect(units(aobScouser)).toBe(20)
  })

  it('names its corners the way the tables do', () => {
    // "corner 5/9" means the block 5, 6, 8, 9.
    const c = betsOf(aobScouser).find(b => b.payout === 8)!
    expect(c.numbers).toEqual([5, 6, 8, 9])
  })
})

describe('Controlled Chaos', () => {
  it('follows the winner: low after a low, high after a high', () => {
    expect(betsOf(aobChaosFtw, [7]).map(b => b.label)).toEqual(['1-18', 'dozen 1'])
    expect(betsOf(aobChaosFtw, [30]).map(b => b.label)).toEqual(['19-36', 'dozen 3'])
  })

  it('follows the loser: the mirror of FTW on the same spin', () => {
    expect(betsOf(aobChaosFtl, [7]).map(b => b.label)).toEqual(['19-36', 'dozen 3'])
    expect(betsOf(aobChaosFtl, [30]).map(b => b.label)).toEqual(['1-18', 'dozen 1'])
  })

  it('stakes 2 units on the even-money box and 1 on the dozen', () => {
    const bets = betsOf(aobChaosFtw, [7])
    expect(bets.find(b => b.payout === 1)!.units).toBe(2)
    expect(bets.find(b => b.payout === 2)!.units).toBe(1)
    expect(units(aobChaosFtw, [7])).toBe(3)
  })
})

describe('the All on Black set as a whole', () => {
  it('never places a bet on a pocket that does not exist', () => {
    for (const s of ALL_ON_BLACK_SYSTEMS) {
      for (const ns of [[], [0], [17], [36], [12, 28, 0]]) {
        for (const b of s.bets({ spins: spins(ns), config })) {
          expect(b.numbers.length).toBeGreaterThan(0)
          for (const n of b.numbers) {
            expect(n).toBeGreaterThanOrEqual(0)
            expect(n).toBeLessThanOrEqual(36)
          }
          expect(b.units).toBeGreaterThan(0)
        }
      }
    }
  })

  it('never stakes the same pocket twice inside one bet', () => {
    for (const s of ALL_ON_BLACK_SYSTEMS) {
      for (const b of s.bets({ spins: spins([17]), config })) {
        expect(new Set(b.numbers).size).toBe(b.numbers.length)
      }
    }
  })

  it('is registered with unique ids and reachable from the main list', () => {
    const ids = ALL_ON_BLACK_SYSTEMS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const all = new Set(ALL_PLACEMENT_SYSTEMS.map(s => s.id))
    for (const id of ids) expect(all.has(id)).toBe(true)
  })
})

describe('3x/2x Recovery progression', () => {
  const L: SpinOutcome = 'loss'
  const W: SpinOutcome = 'win'
  const stakes = (script: SpinOutcome[]) => {
    let state = threeThenTwoRecovery.initial()
    return script.map(o => {
      const m = threeThenTwoRecovery.multiplier(state)
      state = threeThenTwoRecovery.next(state, o, o === 'win' ? m : -m)
      return m
    })
  }

  it('triples twice then doubles, as the channel describes', () => {
    expect(stakes([L, L, L, L, L])).toEqual([1, 3, 9, 18, 36])
  })

  it('resets to the opening stake on a win', () => {
    expect(stakes([L, L, W, L])).toEqual([1, 3, 9, 1])
  })
})
