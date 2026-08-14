import {
  colorOf,
  columnOf,
  dozenOf,
  isZero,
  labelOf,
  pocketsFor,
  SECTOR_LABELS,
  wheelSectors,
} from './roulette'
import type { Spin, WheelType } from './types'

/** Expected hits per pocket below which a chi-squared test is not trustworthy. */
const MIN_EXPECTED_PER_POCKET = 5

export interface ChiReading {
  /** Degrees of freedom — one less than the number of pockets. */
  df: number
  /** How many hits each pocket "should" have had by now. */
  expectedPerPocket: number
  /** True once there are enough spins for the statistic to mean anything. */
  reliable: boolean
  /** Spins still needed before it becomes reliable. */
  spinsNeeded: number
  /** The result expressed in standard deviations, so it reads like the rest. */
  z: number
  /** Short verdict for display. */
  verdict: string
  /** The longer explanation, for the tooltip. */
  detail: string
}

/**
 * Turns a raw chi-squared into something a player can act on.
 *
 * A fair wheel averages a chi-squared roughly equal to its degrees of freedom
 * (about 36 on a single-zero wheel), so the bare number says little on its own.
 * The Wilson–Hilferty transform re-expresses it in standard deviations, which
 * matches how every other confidence figure in the app reads.
 */
export function readChiSquared(
  chi: number,
  df: number,
  expectedPerPocket: number,
): ChiReading {
  const pockets = df + 1
  const reliable = expectedPerPocket >= MIN_EXPECTED_PER_POCKET
  const spinsNeeded = Math.max(0, Math.ceil(MIN_EXPECTED_PER_POCKET * pockets - expectedPerPocket * pockets))
  // Wilson–Hilferty: accurate for the df a roulette wheel gives us. A chi of
  // exactly 0 is a real (wildly improbable) result, not a missing value, so it
  // must transform normally rather than short-circuit to zero.
  const z =
    df > 0 ? (Math.cbrt(chi / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df)) : 0

  if (!reliable) {
    return {
      df,
      expectedPerPocket,
      reliable: false,
      spinsNeeded,
      z,
      verdict: `needs ${spinsNeeded} more spins`,
      detail: `A chi-squared test needs at least ${MIN_EXPECTED_PER_POCKET} expected hits per pocket to mean anything. Each pocket is currently expected to have hit ${expectedPerPocket.toFixed(1)} times, so this number is still mostly noise.`,
    }
  }
  const verdict =
    z < 1.5
      ? 'normal for a fair wheel'
      : z < 2.5
        ? 'slightly uneven — still ordinary'
        : z < 3.5
          ? 'lumpier than usual — worth watching'
          : 'very uneven for a fair wheel'
  return {
    df,
    expectedPerPocket,
    reliable: true,
    spinsNeeded: 0,
    z,
    verdict,
    detail: `A fair wheel averages about ${df} here, and this session is ${z >= 0 ? 'above' : 'below'} that by ${Math.abs(z).toFixed(1)} standard deviations. Bear in mind a real biased wheel favours a physical sector, so check the sector bars too — and a lumpy sample is far more often luck than a faulty wheel.`,
  }
}

export interface GroupSplit {
  label: string
  count: number
  pct: number
}

export interface NumberFreq {
  n: number
  label: string
  count: number
  /** Spins since this number last hit; Infinity if never. */
  gap: number
}

export interface SessionStats {
  total: number
  colors: GroupSplit[]
  oddEven: GroupSplit[]
  highLow: GroupSplit[]
  dozens: GroupSplit[]
  columns: GroupSplit[]
  zeros: number
  hot: NumberFreq[]
  cold: NumberFreq[]
  /** Numbers that have not hit for the longest time. */
  sleepers: NumberFreq[]
  currentColorStreak: { color: string; length: number }
  longestColorStreak: { color: string; length: number }
  /** Chi-squared statistic of number frequencies vs uniform. */
  chiSquared: number
  /** Plain-English reading of that statistic, with its own reliability check. */
  chi: ChiReading
  /** Hits per physical wheel half/quarter sectors. */
  sectors: GroupSplit[]
  /** Mean gap between repeats of any number (repeat rate indicator). */
  repeatCount: number
}

function split(labels: string[], counts: number[], total: number): GroupSplit[] {
  return labels.map((label, i) => ({
    label,
    count: counts[i],
    pct: total === 0 ? 0 : (counts[i] / total) * 100,
  }))
}

export function computeStats(spins: Spin[], wheel: WheelType): SessionStats {
  const total = spins.length
  const pockets = pocketsFor(wheel)

  const colorCounts = { red: 0, black: 0, green: 0 }
  let odd = 0,
    even = 0,
    low = 0,
    high = 0,
    zeros = 0
  const dozenCounts = [0, 0, 0, 0]
  const columnCounts = [0, 0, 0, 0]
  const freq = new Map<number, number>()
  const lastSeen = new Map<number, number>()
  let repeatCount = 0

  spins.forEach((s, i) => {
    colorCounts[colorOf(s.n)]++
    if (isZero(s.n)) {
      zeros++
    } else {
      if (s.n % 2 === 1) odd++
      else even++
      if (s.n <= 18) low++
      else high++
    }
    dozenCounts[dozenOf(s.n)]++
    columnCounts[columnOf(s.n)]++
    freq.set(s.n, (freq.get(s.n) ?? 0) + 1)
    if (i > 0 && spins[i - 1].n === s.n) repeatCount++
    lastSeen.set(s.n, i)
  })

  const numberFreqs: NumberFreq[] = pockets.map(n => ({
    n,
    label: labelOf(n),
    count: freq.get(n) ?? 0,
    gap: lastSeen.has(n) ? total - 1 - (lastSeen.get(n) as number) : Infinity,
  }))

  const hot = [...numberFreqs]
    .filter(f => f.count > 0)
    .sort((a, b) => b.count - a.count || a.gap - b.gap)
    .slice(0, 5)
  const cold = [...numberFreqs]
    .sort((a, b) => a.count - b.count || b.gap - a.gap)
    .slice(0, 5)
  const sleepers = [...numberFreqs]
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5)

  // Color streaks (greens break streaks).
  let currentStreak = { color: '-', length: 0 }
  let longestStreak = { color: '-', length: 0 }
  let runColor = ''
  let runLen = 0
  for (const s of spins) {
    const c = colorOf(s.n)
    if (c === runColor) runLen++
    else {
      runColor = c
      runLen = 1
    }
    if (runLen > longestStreak.length && c !== 'green') {
      longestStreak = { color: c, length: runLen }
    }
  }
  if (spins.length > 0) currentStreak = { color: runColor, length: runLen }

  // Chi-squared vs uniform distribution across pockets.
  const expected = total / pockets.length
  let chi = 0
  if (total > 0) {
    for (const f of numberFreqs) {
      chi += (f.count - expected) ** 2 / expected
    }
  }
  const chiReading = readChiSquared(chi, pockets.length - 1, expected)

  // Physical wheel quarters (sector bias at a glance). The arcs come from the
  // shared helper so the stats and the sector betting systems always agree.
  const sectors = wheelSectors(wheel)
  const sectorCounts = [0, 0, 0, 0]
  const sectorIndex = new Map<number, number>()
  sectors.forEach((arc, i) => arc.forEach(n => sectorIndex.set(n, i)))
  for (const s of spins) sectorCounts[sectorIndex.get(s.n) ?? 0]++

  return {
    total,
    colors: split(
      ['Red', 'Black', 'Green'],
      [colorCounts.red, colorCounts.black, colorCounts.green],
      total,
    ),
    oddEven: split(['Odd', 'Even'], [odd, even], total),
    highLow: split(['1-18', '19-36'], [low, high], total),
    dozens: split(
      ['1st 12', '2nd 12', '3rd 12'],
      [dozenCounts[1], dozenCounts[2], dozenCounts[3]],
      total,
    ),
    columns: split(
      ['Col 1', 'Col 2', 'Col 3'],
      [columnCounts[1], columnCounts[2], columnCounts[3]],
      total,
    ),
    zeros,
    hot,
    cold,
    sleepers,
    currentColorStreak: currentStreak,
    longestColorStreak: longestStreak,
    chiSquared: chi,
    chi: chiReading,
    sectors: split(
      sectors.map((arc, i) => `${SECTOR_LABELS[i]} (${arc.length})`),
      sectorCounts,
      total,
    ),
    repeatCount,
  }
}
