import { describe, expect, it } from 'vitest'
import { placementSystems } from '../placement'
import {
  EUROPEAN_WHEEL_ORDER,
  SECTOR_COUNT,
  SECTOR_LABELS,
  sectorOf,
  wheelOrder,
  wheelSectors,
} from '../roulette'
import { coldSector, hotSector, sleepingSector } from '../placement/systems'
import { dalembert } from '../money/systems'
import { simulateCombo } from '../simulation'
import type { TraceEntry } from '../simulation'
import {
  lastNumberNeighbours,
  lastNumberNeighbours3,
  lastNumberNeighbours7,
  lastNumberNeighbours9,
  lastNumberNeighbours11,
  followLastColumn,
  followLastDozen,
  followLastHighLow,
  followLastOddEven,
  oppositeLastColumn,
  oppositeLastDozen,
  oppositeLastHighLow,
  oppositeLastOddEven,
  sleepersDozen,
  sleepingColor,
  sleepingColumn,
  sleepingHighLow,
  sleepingOddEven,
  sleeperGB,
} from '../placement/systems'
import type { PlacementSystem } from '../placement'
import type { SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 500,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))
const labels = (system: PlacementSystem, ns: number[]) =>
  system.bets({ spins: spins(ns), config }).map(b => b.label)

describe('wheel sectors', () => {
  it('cuts the wheel into arcs of as-equal size as the pockets allow', () => {
    for (const wheel of ['european', 'american'] as const) {
      const sizes = wheelSectors(wheel).map(s => s.length)
      // The old fixed-width split left the last arc with 7 of 37 pockets, so it
      // read as permanently cold. No arc may be more than one pocket off another.
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(wheelOrder(wheel).length)
    }
  })

  it('covers every pocket exactly once', () => {
    for (const wheel of ['european', 'american'] as const) {
      const all = wheelSectors(wheel).flat()
      expect(new Set(all).size).toBe(wheelOrder(wheel).length)
    }
  })

  it('agrees with sectorOf for every pocket', () => {
    const sectors = wheelSectors('european')
    sectors.forEach((arc, i) => {
      for (const n of arc) expect(sectorOf(n, 'european')).toBe(i)
    })
  })

  it('builds arcs from physically adjacent pockets', () => {
    // Each arc must be a contiguous run of the wheel order, not scattered.
    const order = wheelOrder('european')
    for (const arc of wheelSectors('european')) {
      const idx = arc.map(n => order.indexOf(n)).sort((a, b) => a - b)
      expect(idx[idx.length - 1] - idx[0]).toBe(idx.length - 1)
    }
  })
})

describe('sector betting systems', () => {
  const sectors = wheelSectors('european')

  it('waits for a few spins before backing an arc', () => {
    expect(hotSector.bets({ spins: spins([1, 2]), config })).toEqual([])
    expect(coldSector.bets({ spins: spins([1, 2]), config })).toEqual([])
  })

  it('backs the arc that hit most, covering every pocket in it', () => {
    // Six hits inside sector 0, one elsewhere.
    const hits = [...sectors[0].slice(0, 6), sectors[2][0]]
    const bets = hotSector.bets({ spins: spins(hits), config })
    expect(bets.map(b => b.numbers[0]).sort((a, b) => a - b)).toEqual(
      [...sectors[0]].sort((a, b) => a - b),
    )
    for (const b of bets) expect(b.payout).toBe(35)
  })

  it('backs the arc that hit least', () => {
    // Load sectors 0,1,2 and leave 3 untouched.
    const hits = [...sectors[0], ...sectors[1], ...sectors[2]]
    const bets = coldSector.bets({ spins: spins(hits), config })
    expect(bets.map(b => b.numbers[0]).sort((a, b) => a - b)).toEqual(
      [...sectors[3]].sort((a, b) => a - b),
    )
  })

  it('sits out until an arc has genuinely gone quiet', () => {
    // Every sector hit recently: nothing is asleep.
    const busy = Array.from({ length: 12 }, (_, i) => sectors[i % SECTOR_COUNT][0])
    expect(sleepingSector.bets({ spins: spins(busy), config })).toEqual([])
  })

  it('backs a sector once it has slept long enough, as its own leg', () => {
    // Ten spins all inside sector 0 leaves 1, 2 and 3 asleep for ten spins.
    const quiet = Array.from({ length: 10 }, (_, i) => sectors[0][i % sectors[0].length])
    const bets = sleepingSector.bets({ spins: spins(quiet), config })
    const legs = new Set(bets.map(b => b.leg))
    expect(legs).toEqual(new Set(['Sector B', 'Sector C', 'Sector D']))
    // None of the sleeping bets may come from the arc that has been hitting.
    for (const b of bets) expect(sectors[0]).not.toContain(b.numbers[0])
  })
})

describe('sector legs advance their own progressions', () => {
  const cfg: SessionConfig = { ...config, startingBankroll: 1e9 }

  it('steps a leg DOWN after that leg wins, even across spins it sat out', () => {
    const sectors = wheelSectors('european')
    // Hammer sector A so B/C/D sleep and climb, let B hit, then sleep B again.
    const seq: number[] = []
    for (let i = 0; i < 14; i++) seq.push(sectors[0][i % sectors[0].length])
    seq.push(sectors[1][0])
    for (let i = 0; i < 14; i++) seq.push(sectors[0][i % sectors[0].length])
    const r = simulateCombo(sleepingSector, dalembert, spins(seq), cfg, { trace: true })

    const stakeOf = (t: TraceEntry | undefined, sector: number) =>
      t?.bets.find(b => sectorOf(b.numbers[0], 'european') === sector)?.amount

    // Sector B's last stake before its win, and its first stake after.
    const winIdx = r.trace!.findIndex(t => t.bets.some(b => b.numbers[0] === sectors[1][0] && b.won))
    expect(winIdx).toBeGreaterThan(-1)
    const before = stakeOf(r.trace![winIdx], 1)!
    const after = r.trace!.slice(winIdx + 1).map(t => stakeOf(t, 1)).find(a => a !== undefined)!
    // D'Alembert: one unit lower than the winning stake, however long it waited.
    expect(after).toBeCloseTo(before - cfg.baseUnit, 6)
  })

  it('lets a leg that lost stake UP on a spin the session won overall', () => {
    // The behaviour that looks like a bug: one arc hits, so the spin nets a
    // profit, but the other arcs lost and correctly climb next time.
    const sectors = wheelSectors('european')
    const seq: number[] = []
    for (let i = 0; i < 14; i++) seq.push(sectors[0][i % sectors[0].length])
    seq.push(sectors[1][0])
    seq.push(sectors[0][0])
    const r = simulateCombo(sleepingSector, dalembert, spins(seq), cfg, { trace: true })
    const winIdx = r.trace!.findIndex(t => t.net > 0)
    expect(winIdx).toBeGreaterThan(-1)
    const cBefore = r.trace![winIdx].bets.find(b => sectorOf(b.numbers[0], 'european') === 2)!.amount
    const cAfter = r.trace![winIdx + 1].bets.find(b => sectorOf(b.numbers[0], 'european') === 2)!.amount
    expect(r.trace![winIdx].net).toBeGreaterThan(0)
    expect(cAfter).toBeCloseTo(cBefore + cfg.baseUnit, 6)
  })

  it('tags every chip with the leg that priced it', () => {
    const sectors = wheelSectors('european')
    const seq = Array.from({ length: 12 }, (_, i) => sectors[0][i % sectors[0].length])
    const r = simulateCombo(sleepingSector, dalembert, spins(seq), cfg, { trace: true })
    const withBets = r.trace!.find(t => t.bets.length > 0)!
    for (const b of withBets.bets) {
      expect(b.leg).toBe(SECTOR_LABELS[sectorOf(b.numbers[0], 'european')])
    }
  })
})

describe('Neighbours of the Last', () => {
  const variants: [PlacementSystem, number][] = [
    [lastNumberNeighbours3, 3],
    [lastNumberNeighbours, 5],
    [lastNumberNeighbours7, 7],
    [lastNumberNeighbours9, 9],
    [lastNumberNeighbours11, 11],
  ]

  it('covers exactly the pocket count in its name', () => {
    for (const [system, count] of variants) {
      const bets = system.bets({ spins: spins([17]), config })
      expect(bets).toHaveLength(count)
      expect(system.name).toContain(`${count} numbers`)
      // Every pocket is distinct — no double-staking from a bad wrap.
      expect(new Set(bets.flatMap(b => b.numbers)).size).toBe(count)
    }
  })

  it('takes the physical wheel neighbours, centred on the last number', () => {
    // 0 sits between 26 and 32 on a European wheel.
    const around0 = lastNumberNeighbours3.bets({ spins: spins([0]), config })
    expect(around0.flatMap(b => b.numbers).sort((a, b) => a - b)).toEqual([0, 26, 32])
  })

  it('wraps around the wheel rather than running off the end', () => {
    // 26 is the last entry in the wheel order, so a wide span must wrap to the
    // start of the array and still return distinct pockets.
    const bets = lastNumberNeighbours11.bets({ spins: spins([26]), config })
    const picks = bets.flatMap(b => b.numbers)
    expect(new Set(picks).size).toBe(11)
    expect(picks).toContain(26)
    for (const n of picks) expect(EUROPEAN_WHEEL_ORDER).toContain(n)
  })

  it('stakes one unit per pocket at 35:1', () => {
    for (const [system] of variants) {
      for (const bet of system.bets({ spins: spins([17]), config })) {
        expect(bet.payout).toBe(35)
        expect(bet.units).toBe(1)
        expect(bet.numbers).toHaveLength(1)
      }
    }
  })

  it('places nothing before the first spin', () => {
    for (const [system] of variants) {
      expect(system.bets({ spins: [], config })).toEqual([])
    }
  })
})

describe('follow the last (dozen)', () => {
  it('backs the dozen the last number fell in', () => {
    expect(labels(followLastDozen, [7])).toEqual(['dozen 1'])
    expect(labels(followLastDozen, [7, 20])).toEqual(['dozen 2'])
    expect(labels(followLastDozen, [7, 20, 33])).toEqual(['dozen 3'])
  })

  it('pays 2:1 and covers twelve numbers', () => {
    const [bet] = followLastDozen.bets({ spins: spins([5]), config })
    expect(bet.payout).toBe(2)
    expect(bet.numbers).toHaveLength(12)
  })

  it('looks past a zero to the last real number', () => {
    expect(labels(followLastDozen, [20, 0])).toEqual(['dozen 2'])
  })

  it('sits out until something other than a zero has landed', () => {
    expect(labels(followLastDozen, [])).toEqual([])
    expect(labels(followLastDozen, [0])).toEqual([])
  })
})

describe('follow the last (column)', () => {
  it('backs the column the last number fell in', () => {
    // 1 is column 1, 2 is column 2, 3 is column 3.
    expect(labels(followLastColumn, [1])).toEqual(['column 1'])
    expect(labels(followLastColumn, [2])).toEqual(['column 2'])
    expect(labels(followLastColumn, [3])).toEqual(['column 3'])
    expect(labels(followLastColumn, [34])).toEqual(['column 1'])
  })

  it('pays 2:1 and covers twelve numbers', () => {
    const [bet] = followLastColumn.bets({ spins: spins([5]), config })
    expect(bet.payout).toBe(2)
    expect(bet.numbers).toHaveLength(12)
  })

  it('sits out with nothing to follow', () => {
    expect(labels(followLastColumn, [0])).toEqual([])
  })
})

describe('follow the last (odd/even)', () => {
  it('matches the parity of the last number', () => {
    expect(labels(followLastOddEven, [7])).toEqual(['odd'])
    expect(labels(followLastOddEven, [7, 8])).toEqual(['even'])
  })

  it('never treats a zero as even', () => {
    // Zero is skipped rather than counted as an even number.
    expect(labels(followLastOddEven, [7, 0])).toEqual(['odd'])
    expect(labels(followLastOddEven, [0])).toEqual([])
  })

  it('pays even money over eighteen numbers', () => {
    const [bet] = followLastOddEven.bets({ spins: spins([7]), config })
    expect(bet.payout).toBe(1)
    expect(bet.numbers).toHaveLength(18)
    expect(bet.numbers).not.toContain(0)
  })
})

describe('follow the last (high/low)', () => {
  it('matches the half the last number fell in', () => {
    expect(labels(followLastHighLow, [18])).toEqual(['1-18'])
    expect(labels(followLastHighLow, [19])).toEqual(['19-36'])
    expect(labels(followLastHighLow, [19, 1])).toEqual(['1-18'])
  })

  it('pays even money over eighteen numbers', () => {
    const [bet] = followLastHighLow.bets({ spins: spins([30]), config })
    expect(bet.payout).toBe(1)
    expect(bet.numbers).toHaveLength(18)
  })

  it('sits out with nothing to follow', () => {
    expect(labels(followLastHighLow, [0])).toEqual([])
  })
})

describe('opposite of last (dozen / column)', () => {
  it('covers the two dozens the last number missed', () => {
    expect(labels(oppositeLastDozen, [7])).toEqual(['dozen 2', 'dozen 3'])
    expect(labels(oppositeLastDozen, [20])).toEqual(['dozen 1', 'dozen 3'])
    expect(labels(oppositeLastDozen, [33])).toEqual(['dozen 1', 'dozen 2'])
  })

  it('covers the two columns the last number missed', () => {
    expect(labels(oppositeLastColumn, [1])).toEqual(['column 2', 'column 3'])
    expect(labels(oppositeLastColumn, [3])).toEqual(['column 1', 'column 2'])
  })

  it('stakes one unit on each side, so a hit nets +1 unit', () => {
    const bets = oppositeLastDozen.bets({ spins: spins([7]), config })
    expect(bets).toHaveLength(2)
    expect(bets.every(b => b.units === 1 && b.payout === 2)).toBe(true)
  })

  it('sits out until a non-zero number lands', () => {
    expect(labels(oppositeLastDozen, [0])).toEqual([])
    expect(labels(oppositeLastColumn, [])).toEqual([])
  })
})

describe('opposite of last (even money)', () => {
  it('fades the parity and the half', () => {
    expect(labels(oppositeLastOddEven, [7])).toEqual(['even'])
    expect(labels(oppositeLastOddEven, [8])).toEqual(['odd'])
    expect(labels(oppositeLastHighLow, [7])).toEqual(['19-36'])
    expect(labels(oppositeLastHighLow, [30])).toEqual(['1-18'])
  })

  it('is the mirror image of the follow version', () => {
    for (const n of [3, 12, 19, 26, 34]) {
      expect(labels(oppositeLastOddEven, [n])).not.toEqual(labels(followLastOddEven, [n]))
      expect(labels(oppositeLastHighLow, [n])).not.toEqual(labels(followLastHighLow, [n]))
    }
  })
})

describe('sleeping systems', () => {
  it('waits for a dozen to be absent six spins, then backs it', () => {
    // Five spins in dozen 1: not yet asleep long enough.
    expect(labels(sleepersDozen, [1, 2, 3, 4, 5])).toEqual([])
    // Six spins in dozen 1 puts dozens 2 and 3 to sleep.
    expect(labels(sleepersDozen, [1, 2, 3, 4, 5, 6])).toEqual(['dozen 2', 'dozen 3'])
  })

  it('applies the same six-spin rule to columns', () => {
    // Every number here is in column 1, so columns 2 and 3 sleep.
    expect(labels(sleepingColumn, [1, 4, 7, 10, 13, 16])).toEqual(['column 2', 'column 3'])
    expect(labels(sleepingColumn, [1, 4, 7, 10, 13])).toEqual([])
  })

  it('uses a four-spin rule for the even-money bets', () => {
    // Four blacks in a row wake up red; three are not enough.
    expect(labels(sleepingColor, [2, 4, 6])).toEqual([])
    expect(labels(sleepingColor, [2, 4, 6, 8])).toEqual(['red'])
    // Four odds put even to sleep.
    expect(labels(sleepingOddEven, [1, 3, 5, 7])).toEqual(['even'])
    // Four lows put the high half to sleep.
    expect(labels(sleepingHighLow, [1, 2, 3, 4])).toEqual(['19-36'])
  })

  it('lets a zero deepen the sleep rather than end it', () => {
    // Three blacks, a zero, then nothing red: red has slept four spins.
    expect(labels(sleepingColor, [2, 4, 6, 0])).toEqual(['red'])
  })

  it('sits out while both sides keep showing up', () => {
    expect(labels(sleepingColor, [1, 2, 1, 2, 1, 2])).toEqual([])
    expect(labels(sleepingOddEven, [1, 2, 3, 4, 5, 6])).toEqual([])
  })
})

describe('Sleeper GB', () => {
  const gbConfig = (gbSleepSpins: number): SessionConfig => ({ ...config, gbSleepSpins })
  const gbBets = (ns: number[], wait = 5) =>
    sleeperGB.bets({ spins: spins(ns), config: gbConfig(wait) })

  it('waits for the sleep length before any leg fires', () => {
    expect(gbBets([1, 1, 1, 1])).toEqual([])
  })

  it('wakes every leg that has slept, each on its own progression', () => {
    // Five spins of 1 (red, odd, low, dozen 1, column 1). Everything those
    // five miss has now slept five spins.
    const bets = gbBets([1, 1, 1, 1, 1])
    const labels = bets.map(b => b.label).sort()
    expect(labels).toEqual(
      ['19-36', 'black', 'column 2', 'column 3', 'dozen 2', 'dozen 3', 'even'].sort(),
    )
    // Each carries its own leg id, which is what keeps the plans separate.
    expect(bets.every(b => b.leg === b.label)).toBe(true)
  })

  it('lets a leg go back to sleep once it hits', () => {
    // Black wakes after five reds, then a black lands and it stands down.
    expect(gbBets([1, 3, 5, 7, 9]).map(b => b.label)).toContain('black')
    expect(gbBets([1, 3, 5, 7, 9, 2]).map(b => b.label)).not.toContain('black')
  })

  it('honours the sleep length set on the session', () => {
    expect(gbBets([1, 1, 1], 3).length).toBeGreaterThan(0)
    expect(gbBets([1, 1, 1], 8)).toEqual([])
  })

  it('counts a zero as a miss for every leg', () => {
    // Five zeros put all twelve outside bets to sleep at once.
    expect(gbBets([0, 0, 0, 0, 0])).toHaveLength(12)
  })

  it('never wakes both sides of the same pair at once', () => {
    const labels = gbBets([1, 1, 1, 1, 1]).map(b => b.label)
    expect(labels).not.toContain('red') // red keeps hitting
    expect(labels).toContain('black')
  })
})

describe('registry', () => {
  it('publishes the new systems with unique ids and payout badges', () => {
    const all = placementSystems()
    const ids = all.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of [
      'follow-last-dozen',
      'follow-last-column',
      'follow-last-odd-even',
      'follow-last-high-low',
      'opposite-last-dozen',
      'opposite-last-column',
      'opposite-last-odd-even',
      'opposite-last-high-low',
      'sleeping-column',
      'sleeping-color',
      'sleeping-odd-even',
      'sleeping-high-low',
    ]) {
      const system = all.find(s => s.id === id)
      expect(system, `${id} should be registered`).toBeDefined()
      expect(system!.summary?.badge).toBeTruthy()
    }
  })
})
