import { NUMBERS_BY_COLUMN, NUMBERS_BY_DOZEN, ALL_HIGH, ALL_LOW } from '../roulette'
import type { Bet } from '../types'
import type { PlacementContext, PlacementSystem } from './types'

/**
 * Strategies published by the "All on Black" YouTube channel, transcribed from
 * their strategy pages so they can be raced against everything else here.
 *
 * Nothing in this file changes the house edge — these are coverage-and-recovery
 * layouts, and the wide ones win most spins while losing more when they lose.
 * They are included to be measured, not because they beat the maths.
 */

// ---------------------------------------------------------------------------
// Bet builders the rest of the app did not need until now
// ---------------------------------------------------------------------------

/** Three numbers in a row: `start` must be 1, 4, 7 … 34. */
function streetBet(start: number, units = 1): Bet {
  return {
    label: `street ${start}-${start + 2}`,
    numbers: [start, start + 1, start + 2],
    payout: 11,
    units,
  }
}

/** Six numbers across two adjacent rows: `start` must be 1, 4, 7 … 31. */
function sixLineBet(start: number, units = 1): Bet {
  return {
    label: `double street ${start}-${start + 5}`,
    numbers: [start, start + 1, start + 2, start + 3, start + 4, start + 5],
    payout: 5,
    units,
  }
}

/**
 * Four numbers in a 2×2 block, named by its lowest number the way the tables
 * do: corner 5 covers 5, 6, 8 and 9. `low` must sit in column 1 or 2.
 */
function cornerBet(low: number, units = 1): Bet {
  const numbers = [low, low + 1, low + 3, low + 4]
  return { label: `corner ${low}-${low + 4}`, numbers, payout: 8, units }
}

function splitBet(a: number, b: number, units = 1): Bet {
  return { label: `split ${a}/${b}`, numbers: [a, b], payout: 17, units }
}

function dozenBet(d: number, units = 1): Bet {
  return { label: `dozen ${d}`, numbers: NUMBERS_BY_DOZEN[d], payout: 2, units }
}

function columnBet(c: number, units = 1): Bet {
  return { label: `column ${c}`, numbers: NUMBERS_BY_COLUMN[c], payout: 2, units }
}

function lowBet(units = 1): Bet {
  return { label: '1-18', numbers: ALL_LOW, payout: 1, units }
}

function highBet(units = 1): Bet {
  return { label: '19-36', numbers: ALL_HIGH, payout: 1, units }
}

/** The six double streets as the table lays them out. */
const DOUBLE_STREETS = [1, 7, 13, 19, 25, 31]

const AOB = 'All on Black'

// ---------------------------------------------------------------------------
// 5 Double Streets — 1 unit on five of the six, one left open
// ---------------------------------------------------------------------------

/** Covers every double street except the one starting at `openStart`. */
function fiveDoubleStreets(openStart: number): Bet[] {
  return DOUBLE_STREETS.filter(s => s !== openStart).map(s => sixLineBet(s))
}

export const aobFiveDoubleStreets: PlacementSystem = {
  id: 'aob-5-double-streets',
  name: '5 Double Streets (AoB)',
  description: `${AOB}: 1 unit on five of the six double streets, leaving 1-6 open. Five units down for one unit of profit — the channel's most widely used layout.`,
  bets: () => fiveDoubleStreets(1),
}

export const aobGoalposts: PlacementSystem = {
  id: 'aob-goalposts',
  name: '5 Double Streets — Goalposts (AoB)',
  description: `${AOB}: the five double streets from 4-9 up to 28-33, so the uncovered "whacks" are 0, 1, 2, 3, 34, 35 and 36 — the two ends of the board rather than one block.`,
  // Offset double streets: these sit between the standard ones.
  bets: () => [4, 10, 16, 22, 28].map(s => sixLineBet(s)),
}

export const aobSlut: PlacementSystem = {
  id: 'aob-slut',
  name: '5 Double Streets — Slut (AoB)',
  description: `${AOB}: five double streets covered, and the open one marches one place to the right every spin regardless of the result, wrapping back to 1-6 at the end.`,
  bets: ({ spins }: PlacementContext) =>
    // Rotation is driven by spin count alone — outcome plays no part.
    fiveDoubleStreets(DOUBLE_STREETS[spins.length % DOUBLE_STREETS.length]),
}

export const aobPlague: PlacementSystem = {
  id: 'aob-plague',
  name: '5 Double Streets — Plague (AoB)',
  description: `${AOB}: five double streets covered, always leaving whichever double street just hit open. A zero has no double street, so the layout holds its previous shape.`,
  bets: ({ spins }: PlacementContext) => {
    if (spins.length === 0) return fiveDoubleStreets(1)
    const last = spins[spins.length - 1].n
    // Zero (and 00) sit outside every double street; keep the stake at five
    // units rather than covering all six on those spins.
    const open = DOUBLE_STREETS.find(s => last >= s && last <= s + 5) ?? 1
    return fiveDoubleStreets(open)
  },
}

// ---------------------------------------------------------------------------
// 9 Streets — three streets in each dozen, 1 unit each, 3 units of profit
// ---------------------------------------------------------------------------

/** Street starts for the `picks` slots (1-4) inside every dozen. */
function nineStreets(picks: number[]): Bet[] {
  const bets: Bet[] = []
  for (let d = 1; d <= 3; d++) {
    const base = (d - 1) * 12 + 1
    for (const p of picks) bets.push(streetBet(base + (p - 1) * 3))
  }
  return bets
}

function nineStreetSystem(picks: number[]): PlacementSystem {
  const key = picks.join(',')
  return {
    id: `aob-9-streets-${picks.join('')}`,
    name: `9 Streets ${key} (AoB)`,
    description: `${AOB}: 1 unit on nine streets — slots ${key} of the four streets inside each dozen — covering 27 numbers for 3 units of profit on a hit.`,
    bets: () => nineStreets(picks),
  }
}

export const aobNineStreets123 = nineStreetSystem([1, 2, 3])
export const aobNineStreets124 = nineStreetSystem([1, 2, 4])
export const aobNineStreets134 = nineStreetSystem([1, 3, 4])
export const aobNineStreets234 = nineStreetSystem([2, 3, 4])

export const aobCentipede: PlacementSystem = {
  id: 'aob-centipede',
  name: '9 Streets — Centipede (AoB)',
  description: `${AOB}: nine CONSECUTIVE streets, 1 unit each, covering 7 through 33 in one solid block instead of spreading across the dozens.`,
  bets: () => [7, 10, 13, 16, 19, 22, 25, 28, 31].map(s => streetBet(s)),
}

// ---------------------------------------------------------------------------
// Millipede — 9 streets at 2u interleaved with 8 double streets at 1u
// ---------------------------------------------------------------------------

export const aobMillipede: PlacementSystem = {
  id: 'aob-millipede',
  name: 'Millipede (AoB)',
  description: `${AOB}: nine streets at 2 units each, interleaved with the eight double streets that straddle them at 1 unit each — 26 units covering 7 through 33. The 7-28 streets are the "bangers"; the 7 street and 31 pay least.`,
  bets: () => [
    ...[7, 10, 13, 16, 19, 22, 25, 28, 31].map(s => streetBet(s, 2)),
    // The straddling double streets overlap the streets above, which is what
    // stacks the middle of the board and leaves the ends thin.
    ...[7, 10, 13, 16, 19, 22, 25, 28].map(s => sixLineBet(s, 1)),
  ],
}

// ---------------------------------------------------------------------------
// CYA — a Romanovsky variation: 9 overlapping corners plus the open column
// ---------------------------------------------------------------------------

/** Nine overlapping corners spanning columns 1 and 2, leaving column 3 open. */
const CYA_CORNERS = [1, 4, 7, 10, 13, 16, 19, 22, 25]

function cyaSystem(columnUnits: number, id: string, name: string, extra: string): PlacementSystem {
  return {
    id,
    name,
    description: `${AOB}: a Romanovsky variation — 1 unit on nine overlapping corners across columns 1 and 2, plus ${columnUnits} units on the open third column. ${extra}`,
    bets: () => [
      ...CYA_CORNERS.map(low => cornerBet(low, 1)),
      columnBet(3, columnUnits),
    ],
  }
}

export const aobCya = cyaSystem(
  5,
  'aob-cya',
  'CYA (AoB)',
  'The two corners at either end are partial losses; the inside corners pay 4 units and a column hit pays 1.',
)

export const aobCyaScouse = cyaSystem(
  6,
  'aob-cya-scouse',
  'CYA — Scouse (AoB)',
  'The Scouse configuration the channel prefers: 6 units on the column instead of 5, which flattens every full win to 3 units.',
)

// ---------------------------------------------------------------------------
// Scouser — 20 units across a split, three streets and four corners
// ---------------------------------------------------------------------------

export const aobScouser: PlacementSystem = {
  id: 'aob-scouser',
  name: 'Scouser (AoB)',
  description: `${AOB} (submitted by ScouseHouse): 2 units on the 0/2 split, 2 units on each of the 10, 19 and 28 streets, and 3 units on each of the 5, 13, 23 and 31 corners. 20 units a spin; corners pay 7, streets 4, and the 0/2 split 16.`,
  bets: () => [
    splitBet(0, 2, 2),
    ...[10, 19, 28].map(s => streetBet(s, 2)),
    ...[5, 13, 23, 31].map(low => cornerBet(low, 3)),
  ],
}

// ---------------------------------------------------------------------------
// Controlled Chaos — an even-money bet hedged with a dozen
// ---------------------------------------------------------------------------

const chaosLow = (): Bet[] => [lowBet(2), dozenBet(1, 1)]
const chaosHigh = (): Bet[] => [highBet(2), dozenBet(3, 1)]

export const aobChaosLow: PlacementSystem = {
  id: 'aob-chaos-low',
  name: 'Controlled Chaos — Low (AoB)',
  description: `${AOB}: 2 units on 1-18 and 1 unit on the first dozen, hedging an even-money bet with dozen coverage. Held static.`,
  bets: () => chaosLow(),
}

export const aobChaosHigh: PlacementSystem = {
  id: 'aob-chaos-high',
  name: 'Controlled Chaos — High (AoB)',
  description: `${AOB}: 2 units on 19-36 and 1 unit on the third dozen. The mirror of the low configuration, held static.`,
  bets: () => chaosHigh(),
}

export const aobChaosFtw: PlacementSystem = {
  id: 'aob-chaos-ftw',
  name: 'Controlled Chaos — FTW (AoB)',
  description: `${AOB}'s preferred variation: follow the winner. Plays the low configuration after a low number and the high configuration after a high one.`,
  bets: ({ spins }: PlacementContext) => {
    const last = spins[spins.length - 1]?.n
    if (last === undefined || last === 0 || last === 37) return chaosLow()
    return last <= 18 ? chaosLow() : chaosHigh()
  },
}

export const aobChaosFtl: PlacementSystem = {
  id: 'aob-chaos-ftl',
  name: 'Controlled Chaos — FTL (AoB)',
  description: `${AOB}: follow the loser. Plays the high configuration after a low number and the low configuration after a high one.`,
  bets: ({ spins }: PlacementContext) => {
    const last = spins[spins.length - 1]?.n
    if (last === undefined || last === 0 || last === 37) return chaosLow()
    return last <= 18 ? chaosHigh() : chaosLow()
  },
}

/**
 * The channel also lists "1:1" and "2 Dozen", which are not repeated here:
 * a single even-money box is already covered by Always Red / Always Black and
 * the Follow-the-Last family, and two dozens by Double Dozen (Hot).
 */
export const ALL_ON_BLACK_SYSTEMS: PlacementSystem[] = [
  aobFiveDoubleStreets,
  aobGoalposts,
  aobSlut,
  aobPlague,
  aobNineStreets123,
  aobNineStreets124,
  aobNineStreets134,
  aobNineStreets234,
  aobCentipede,
  aobMillipede,
  aobCya,
  aobCyaScouse,
  aobScouser,
  aobChaosLow,
  aobChaosHigh,
  aobChaosFtw,
  aobChaosFtl,
]
