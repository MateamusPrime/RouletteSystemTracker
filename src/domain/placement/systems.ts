import {
  ALL_BLACK,
  ALL_EVEN,
  ALL_HIGH,
  ALL_LOW,
  ALL_ODD,
  ALL_RED,
  NUMBERS_BY_COLUMN,
  NUMBERS_BY_DOZEN,
  colorOf,
  columnOf,
  dozenOf,
  isZero,
  labelOf,
  SECTOR_COUNT,
  SECTOR_LABELS,
  sectorOf,
  wheelOrder,
  wheelSectors,
} from '../roulette'
import type { Bet, Spin } from '../types'

import { ALL_ON_BLACK_SYSTEMS } from './allOnBlack'
import { ALL_HOPSCOTCH_SYSTEMS } from './hopscotch'
import type { PlacementContext, PlacementSystem } from './types'

const EVEN_MONEY: Record<string, number[]> = {
  red: ALL_RED,
  black: ALL_BLACK,
  odd: ALL_ODD,
  even: ALL_EVEN,
  low: ALL_LOW,
  high: ALL_HIGH,
}

/** Table names for the outside boxes, matching the felt and custom systems. */
const EVEN_MONEY_LABELS: Record<keyof typeof EVEN_MONEY, string> = {
  red: 'red',
  black: 'black',
  odd: 'odd',
  even: 'even',
  low: '1-18',
  high: '19-36',
}

function evenMoneyBet(kind: keyof typeof EVEN_MONEY, units = 1): Bet {
  return { label: EVEN_MONEY_LABELS[kind], numbers: EVEN_MONEY[kind], payout: 1, units }
}

function dozenBet(d: number, units = 1): Bet {
  return { label: `dozen ${d}`, numbers: NUMBERS_BY_DOZEN[d], payout: 2, units }
}

function columnBet(c: number, units = 1): Bet {
  return { label: `column ${c}`, numbers: NUMBERS_BY_COLUMN[c], payout: 2, units }
}

function lastNonZero(spins: Spin[]): Spin | undefined {
  for (let i = spins.length - 1; i >= 0; i--) {
    if (!isZero(spins[i].n)) return spins[i]
  }
  return undefined
}

/** Frequency of each pocket over the last `window` spins. */
function frequencies(spins: Spin[], window: number): Map<number, number> {
  const freq = new Map<number, number>()
  for (const s of spins.slice(-window)) {
    freq.set(s.n, (freq.get(s.n) ?? 0) + 1)
  }
  return freq
}

function groupCounts(
  spins: Spin[],
  window: number,
  groupOf: (n: number) => number,
): number[] {
  const counts = [0, 0, 0, 0] // index 0 = zeros
  for (const s of spins.slice(-window)) counts[groupOf(s.n)]++
  return counts
}

function hotGroup(counts: number[]): number {
  let best = 1
  for (let g = 2; g <= 3; g++) if (counts[g] > counts[best]) best = g
  return best
}

function coldGroup(counts: number[]): number {
  let worst = 1
  for (let g = 2; g <= 3; g++) if (counts[g] < counts[worst]) worst = g
  return worst
}

/**
 * Groups that have not appeared for at least `gap` spins. Zeros count as
 * "not this group", so a zero deepens every sleep rather than resetting it.
 */
function sleepingGroups(
  spins: Spin[],
  gap: number,
  groupOf: (n: number) => number,
  groupCount: number,
): number[] {
  if (spins.length < gap) return []
  const asleep: number[] = []
  for (let g = 1; g <= groupCount; g++) {
    let since = 0
    for (let i = spins.length - 1; i >= 0; i--) {
      if (groupOf(spins[i].n) === g) break
      since++
    }
    if (since >= gap) asleep.push(g)
  }
  return asleep
}

/**
 * A dozen sleeps through six spins about as often as an even-money bet sleeps
 * through four, so the thresholds differ to make the two fire at a comparable
 * rate rather than leaving the even-money versions almost never triggering.
 */
const DOZEN_SLEEP = 6
const EVEN_MONEY_SLEEP = 4

/** 1 = the first side (red/odd/low), 2 = the second (black/even/high). */
const COLOR_GROUP = (n: number) => (isZero(n) ? 0 : colorOf(n) === 'red' ? 1 : 2)
const ODD_EVEN_GROUP = (n: number) => (isZero(n) ? 0 : n % 2 === 1 ? 1 : 2)
const HIGH_LOW_GROUP = (n: number) => (isZero(n) ? 0 : n <= 18 ? 1 : 2)

export const alwaysRed: PlacementSystem = {
  id: 'always-red',
  name: 'Always Red',
  description: 'Flat even-money bet on red every spin.',
  bets: () => [evenMoneyBet('red')],
}

export const alwaysBlack: PlacementSystem = {
  id: 'always-black',
  name: 'Always Black',
  description: 'Flat even-money bet on black every spin.',
  bets: () => [evenMoneyBet('black')],
}

export const followLastColor: PlacementSystem = {
  id: 'follow-last-color',
  name: 'Follow the Last (Color)',
  description: 'Bets the color that just hit, riding streaks. Defaults to red on the first spin.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return [evenMoneyBet('red')]
    return [evenMoneyBet(colorOf(last.n) === 'red' ? 'red' : 'black')]
  },
}

export const oppositeLastColor: PlacementSystem = {
  id: 'opposite-last-color',
  name: 'Opposite of Last (Color)',
  description: 'Bets against the color that just hit, playing for the chop. Defaults to black on the first spin.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return [evenMoneyBet('black')]
    return [evenMoneyBet(colorOf(last.n) === 'red' ? 'black' : 'red')]
  },
}

export const followLastDozen: PlacementSystem = {
  id: 'follow-last-dozen',
  name: 'Follow the Last (Dozen)',
  description:
    'Bets the dozen the last number fell in, riding whichever third of the board is running. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    return [dozenBet(dozenOf(last.n))]
  },
}

export const followLastColumn: PlacementSystem = {
  id: 'follow-last-column',
  name: 'Follow the Last (Column)',
  description:
    'Bets the column the last number fell in. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    return [columnBet(columnOf(last.n))]
  },
}

export const followLastOddEven: PlacementSystem = {
  id: 'follow-last-odd-even',
  name: 'Follow the Last (Odd/Even)',
  description:
    'Bets odd after an odd number and even after an even one. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    return [evenMoneyBet(last.n % 2 === 1 ? 'odd' : 'even')]
  },
}

export const followLastHighLow: PlacementSystem = {
  id: 'follow-last-high-low',
  name: 'Follow the Last (High/Low)',
  description:
    'Bets 1-18 after a low number and 19-36 after a high one. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    return [evenMoneyBet(last.n <= 18 ? 'low' : 'high')]
  },
}

export const oppositeLastDozen: PlacementSystem = {
  id: 'opposite-last-dozen',
  name: 'Opposite of Last (Dozen)',
  description:
    'Fades the dozen that just hit by covering the other two — one unit each, so a hit nets +1 and a repeat costs 2. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    const hit = dozenOf(last.n)
    return [1, 2, 3].filter(d => d !== hit).map(d => dozenBet(d))
  },
}

export const oppositeLastColumn: PlacementSystem = {
  id: 'opposite-last-column',
  name: 'Opposite of Last (Column)',
  description:
    'Fades the column that just hit by covering the other two — one unit each. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    const hit = columnOf(last.n)
    return [1, 2, 3].filter(c => c !== hit).map(c => columnBet(c))
  },
}

export const oppositeLastOddEven: PlacementSystem = {
  id: 'opposite-last-odd-even',
  name: 'Opposite of Last (Odd/Even)',
  description:
    'Bets even after an odd number and odd after an even one, playing for the chop. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    return [evenMoneyBet(last.n % 2 === 1 ? 'even' : 'odd')]
  },
}

export const oppositeLastHighLow: PlacementSystem = {
  id: 'opposite-last-high-low',
  name: 'Opposite of Last (High/Low)',
  description:
    'Bets 19-36 after a low number and 1-18 after a high one. Sits out until a non-zero number lands.',
  bets: ({ spins }) => {
    const last = lastNonZero(spins)
    if (!last) return []
    return [evenMoneyBet(last.n <= 18 ? 'high' : 'low')]
  },
}

export const streakBreaker: PlacementSystem = {
  id: 'streak-breaker',
  name: 'Streak Breaker',
  description: 'Waits for 3+ of the same color in a row, then bets the opposite color. Sits out otherwise.',
  bets: ({ spins }) => {
    if (spins.length < 3) return []
    const recent = spins.slice(-3).map(s => colorOf(s.n))
    if (recent.some(c => c === 'green')) return []
    if (recent[0] === recent[1] && recent[1] === recent[2]) {
      return [evenMoneyBet(recent[2] === 'red' ? 'black' : 'red')]
    }
    return []
  },
}

export const hotDozen: PlacementSystem = {
  id: 'hot-dozen',
  name: 'Hot Dozen',
  description: 'Bets the dozen that hit most in the last 12 spins (2:1 payout).',
  bets: ({ spins }) => {
    if (spins.length < 3) return []
    return [dozenBet(hotGroup(groupCounts(spins, 12, dozenOf)))]
  },
}

export const coldDozen: PlacementSystem = {
  id: 'cold-dozen',
  name: 'Cold Dozen',
  description: 'Bets the dozen that hit least in the last 12 spins, playing for the catch-up.',
  bets: ({ spins }) => {
    if (spins.length < 3) return []
    return [dozenBet(coldGroup(groupCounts(spins, 12, dozenOf)))]
  },
}

export const doubleDozen: PlacementSystem = {
  id: 'double-dozen',
  name: 'Double Dozen (Hot)',
  description: 'Covers the two hottest dozens of the last 15 spins, one unit each — wins net +1, losses cost 2.',
  bets: ({ spins }) => {
    if (spins.length < 3) return []
    const counts = groupCounts(spins, 15, dozenOf)
    const ranked = [1, 2, 3].sort((a, b) => counts[b] - counts[a])
    return [dozenBet(ranked[0]), dozenBet(ranked[1])]
  },
}

export const hotColumn: PlacementSystem = {
  id: 'hot-column',
  name: 'Hot Column',
  description: 'Bets the column that hit most in the last 12 spins (2:1 payout).',
  bets: ({ spins }) => {
    if (spins.length < 3) return []
    return [columnBet(hotGroup(groupCounts(spins, 12, columnOf)))]
  },
}

export const hotNumbers: PlacementSystem = {
  id: 'hot-numbers',
  name: 'Hot Numbers (Top 3)',
  description: 'Straight-up bets on the 3 most frequent numbers of the last 24 spins (35:1 each).',
  bets: ({ spins }) => {
    if (spins.length < 6) return []
    const freq = frequencies(spins, 24)
    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n]) => n)
    return top.map(n => ({
      label: `straight ${labelOf(n)}`,
      numbers: [n],
      payout: 35,
      units: 1,
    }))
  },
}

/**
 * Straight-ups on the last number and `span` physical neighbours each side, so
 * the sector covers `span * 2 + 1` pockets. Named by the pocket count rather
 * than the span, because that is how the bet is called at the table.
 */
function neighboursOfLast(id: string, span: number): PlacementSystem {
  const covered = span * 2 + 1
  return {
    id,
    name: `Neighbours of the Last (${covered} numbers)`,
    description: `Straight-up bets on the last number plus its ${span} physical neighbour${span === 1 ? '' : 's'} on each side of the wheel (${covered} numbers, ${covered} units a spin).`,
    bets: ({ spins, config }: PlacementContext) => {
      if (spins.length === 0) return []
      const order = wheelOrder(config.wheelType)
      const last = spins[spins.length - 1].n
      const idx = order.indexOf(last)
      if (idx === -1) return []
      const picks: number[] = []
      for (let off = -span; off <= span; off++) {
        picks.push(order[(idx + off + order.length) % order.length])
      }
      return picks.map(n => ({
        label: `straight ${labelOf(n)}`,
        numbers: [n],
        payout: 35,
        units: 1,
      }))
    },
  }
}

export const lastNumberNeighbours3 = neighboursOfLast('neighbours-of-last-3', 1)
/** Keeps its original id so saved sessions and systems still resolve. */
export const lastNumberNeighbours = neighboursOfLast('neighbours-of-last', 2)
export const lastNumberNeighbours7 = neighboursOfLast('neighbours-of-last-7', 3)
export const lastNumberNeighbours9 = neighboursOfLast('neighbours-of-last-9', 4)
export const lastNumberNeighbours11 = neighboursOfLast('neighbours-of-last-11', 5)

export const sleepersDozen: PlacementSystem = {
  id: 'sleeper-dozen',
  name: 'Sleeping Dozen',
  description: `Bets a dozen only after it has not hit for ${DOZEN_SLEEP}+ consecutive spins. Backs every dozen that qualifies, so it can sit out for long stretches.`,
  bets: ({ spins }) =>
    sleepingGroups(spins, DOZEN_SLEEP, dozenOf, 3).map(d => dozenBet(d)),
}

export const sleepingColumn: PlacementSystem = {
  id: 'sleeping-column',
  name: 'Sleeping Column',
  description: `Bets a column only after it has not hit for ${DOZEN_SLEEP}+ consecutive spins. Backs every column that qualifies.`,
  bets: ({ spins }) =>
    sleepingGroups(spins, DOZEN_SLEEP, columnOf, 3).map(c => columnBet(c)),
}

export const sleepingColor: PlacementSystem = {
  id: 'sleeping-color',
  name: 'Sleeping Color',
  description: `Bets a color once it has been absent for ${EVEN_MONEY_SLEEP}+ spins. Unlike Streak Breaker, zeros deepen the sleep instead of ending it.`,
  bets: ({ spins }) =>
    sleepingGroups(spins, EVEN_MONEY_SLEEP, COLOR_GROUP, 2).map(g =>
      evenMoneyBet(g === 1 ? 'red' : 'black'),
    ),
}

export const sleepingOddEven: PlacementSystem = {
  id: 'sleeping-odd-even',
  name: 'Sleeping Odd/Even',
  description: `Bets odd or even once that side has been absent for ${EVEN_MONEY_SLEEP}+ spins.`,
  bets: ({ spins }) =>
    sleepingGroups(spins, EVEN_MONEY_SLEEP, ODD_EVEN_GROUP, 2).map(g =>
      evenMoneyBet(g === 1 ? 'odd' : 'even'),
    ),
}

export const sleepingHighLow: PlacementSystem = {
  id: 'sleeping-high-low',
  name: 'Sleeping High/Low',
  description: `Bets 1-18 or 19-36 once that half has been absent for ${EVEN_MONEY_SLEEP}+ spins.`,
  bets: ({ spins }) =>
    sleepingGroups(spins, EVEN_MONEY_SLEEP, HIGH_LOW_GROUP, 2).map(g =>
      evenMoneyBet(g === 1 ? 'low' : 'high'),
    ),
}

/** How long a GB leg sleeps before it starts betting, unless the session says otherwise. */
export const DEFAULT_GB_SLEEP = 5

/** The twelve outside bets a GB system tracks as separate legs. */
const GB_LEGS: { id: string; make(): Bet; hits(n: number): boolean }[] = [
  ...(['red', 'black', 'odd', 'even', 'low', 'high'] as const).map(kind => ({
    id: EVEN_MONEY_LABELS[kind],
    make: () => evenMoneyBet(kind),
    hits: (n: number) => !isZero(n) && EVEN_MONEY[kind].includes(n),
  })),
  ...[1, 2, 3].map(d => ({
    id: `dozen ${d}`,
    make: () => dozenBet(d),
    hits: (n: number) => dozenOf(n) === d,
  })),
  ...[1, 2, 3].map(c => ({
    id: `column ${c}`,
    make: () => columnBet(c),
    hits: (n: number) => columnOf(n) === c,
  })),
]

/** True when nothing in the last `wait` spins hit this leg. */
function legIsAsleep(
  leg: (typeof GB_LEGS)[number],
  spins: Spin[],
  wait: number,
): boolean {
  if (spins.length < wait) return false
  // Only the last `wait` spins matter, which keeps this constant-time.
  for (let i = spins.length - 1; i >= 0 && spins.length - i <= wait; i--) {
    if (leg.hits(spins[i].n)) return false
  }
  return true
}

/**
 * GB = several independent legs running at once. All twelve outside bets are
 * watched separately; each starts betting once it has slept long enough and
 * carries its OWN money-management progression, while every leg draws on the
 * same bankroll. Ten quiet legs cost nothing, but several waking together
 * stack up fast — which is the whole point of watching the bankroll.
 */
export const sleeperGB: PlacementSystem = {
  id: 'sleeper-gb',
  name: 'Sleeper GB',
  description:
    'Watches all twelve outside bets — both colors, odd/even, both halves, three dozens and three columns — as independent legs. A leg starts betting once it has not hit for the session\'s GB sleep length, and each leg runs its own money-management progression off the shared bankroll.',
  bets: ({ spins, config }) => {
    const wait = Math.max(1, config.gbSleepSpins ?? DEFAULT_GB_SLEEP)
    return GB_LEGS.filter(leg => legIsAsleep(leg, spins, wait)).map(leg => ({
      ...leg.make(),
      leg: leg.id,
    }))
  },
}

/** How many recent spins the sector systems judge hot and cold over. */
const SECTOR_WINDOW = 20
/** Spins a sector must stay quiet before the sleeper system backs it. */
const SECTOR_SLEEP = 8

/** Straight-up chips across every pocket of one physical arc of the wheel. */
function sectorBets(wheel: PlacementContext['config']['wheelType'], index: number): Bet[] {
  return wheelSectors(wheel)[index].map(n => ({
    label: `straight ${labelOf(n)}`,
    numbers: [n],
    payout: 35,
    units: 1,
  }))
}

/** Hits per sector over the last `window` spins. */
function sectorCounts(spins: Spin[], window: number, wheel: PlacementContext['config']['wheelType']) {
  const counts = Array(SECTOR_COUNT).fill(0)
  for (const s of spins.slice(-window)) counts[sectorOf(s.n, wheel)]++
  return counts
}

function extremeSector(counts: number[], pick: 'hot' | 'cold'): number {
  let best = 0
  for (let i = 1; i < counts.length; i++) {
    if (pick === 'hot' ? counts[i] > counts[best] : counts[i] < counts[best]) best = i
  }
  return best
}

/** The ten pockets the Broke Dick Jelly spread covers. */
const BDJ_NUMBERS = [2, 4, 6, 13, 17, 21, 25, 27, 34, 36]

/**
 * The Broke Dick Jelly spread with its ladder taken out: the same ten numbers,
 * a flat unit on each. The original bakes in a five-step D'Alembert that gives
 * up and restarts, which is reproduced exactly by pairing this with
 * "D'Alembert 5-Step (reset on win)" — while every other plan is now available
 * to it too.
 */
export const brokeDickJellyFlat: PlacementSystem = {
  id: 'broke-dick-jelly-flat',
  name: 'Broke Dick Jelly (flat)',
  description:
    'Straight up on ten fixed numbers — 2, 4, 6, 13, 17, 21, 25, 27, 34 and 36 — one unit each, every spin. Pair with D\'Alembert 5-Step (reset on win) for the original progression, or any other plan for a different one.',
  bets: () =>
    BDJ_NUMBERS.map(n => ({
      label: `straight ${labelOf(n)}`,
      numbers: [n],
      payout: 35,
      units: 1,
    })),
}

export const hotSector: PlacementSystem = {
  id: 'hot-sector',
  name: 'Hot Sector',
  description: `Backs every pocket in the physical quarter of the wheel that hit most over the last ${SECTOR_WINDOW} spins — the classic wheel-bias play. Straight up at 35:1 across the whole arc.`,
  bets: ({ spins, config }: PlacementContext) => {
    if (spins.length < 4) return []
    const counts = sectorCounts(spins, SECTOR_WINDOW, config.wheelType)
    return sectorBets(config.wheelType, extremeSector(counts, 'hot'))
  },
}

export const coldSector: PlacementSystem = {
  id: 'cold-sector',
  name: 'Cold Sector',
  description: `Backs every pocket in the physical quarter of the wheel that hit least over the last ${SECTOR_WINDOW} spins, playing for the catch-up. Straight up at 35:1 across the whole arc.`,
  bets: ({ spins, config }: PlacementContext) => {
    if (spins.length < 4) return []
    const counts = sectorCounts(spins, SECTOR_WINDOW, config.wheelType)
    return sectorBets(config.wheelType, extremeSector(counts, 'cold'))
  },
}

export const sleepingSector: PlacementSystem = {
  id: 'sleeping-sector',
  name: 'Sleeping Sector',
  description: `Backs any physical quarter of the wheel that has not hit for ${SECTOR_SLEEP}+ consecutive spins, so it sits out until an arc genuinely goes quiet.`,
  bets: ({ spins, config }: PlacementContext) => {
    if (spins.length < SECTOR_SLEEP) return []
    const bets: Bet[] = []
    for (let i = 0; i < SECTOR_COUNT; i++) {
      let since = 0
      for (let k = spins.length - 1; k >= 0; k--) {
        if (sectorOf(spins[k].n, config.wheelType) === i) break
        since++
      }
      // Each sleeping arc is its own leg so their progressions run separately.
      if (since >= SECTOR_SLEEP) {
        bets.push(...sectorBets(config.wheelType, i).map(b => ({ ...b, leg: SECTOR_LABELS[i] })))
      }
    }
    return bets
  },
}

export const ALL_PLACEMENT_SYSTEMS: PlacementSystem[] = [
  ...ALL_ON_BLACK_SYSTEMS,
  ...ALL_HOPSCOTCH_SYSTEMS,
  alwaysRed,
  alwaysBlack,
  followLastColor,
  oppositeLastColor,
  followLastDozen,
  followLastColumn,
  followLastOddEven,
  followLastHighLow,
  oppositeLastDozen,
  oppositeLastColumn,
  oppositeLastOddEven,
  oppositeLastHighLow,
  streakBreaker,
  hotDozen,
  coldDozen,
  doubleDozen,
  hotColumn,
  hotNumbers,
  lastNumberNeighbours3,
  lastNumberNeighbours,
  lastNumberNeighbours7,
  lastNumberNeighbours9,
  lastNumberNeighbours11,
  brokeDickJellyFlat,
  hotSector,
  coldSector,
  sleepingSector,
  sleepersDozen,
  sleepingColumn,
  sleepingColor,
  sleepingOddEven,
  sleepingHighLow,
  sleeperGB,
]
