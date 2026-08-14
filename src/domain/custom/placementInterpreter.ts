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
  pocketsFor,
  wheelOrder,
} from '../roulette'
import type { Bet, SessionConfig, Spin } from '../types'
import type { PlacementSystem } from '../placement'
import type { AnyPlacementDef, BetRule, ConditionDef, PlacementDef, TargetDef } from './types'
import { isGbPlacement, isMartiPlacement, isStepPlacement } from './types'
import { buildStepPlacementSystem } from './stepInterpreter'
import { buildGbPlacementSystem } from './gbInterpreter'
import { buildMartiPlacementSystem } from './martiInterpreter'

interface ResolvedTarget {
  label: string
  numbers: number[]
  payout: number
  /** Straight-up targets stake `units` PER number. */
  perNumber: boolean
}

const FIXED_TARGETS: Record<string, { label: string; numbers: number[]; payout: number }> = {
  red: { label: 'red', numbers: ALL_RED, payout: 1 },
  black: { label: 'black', numbers: ALL_BLACK, payout: 1 },
  odd: { label: 'odd', numbers: ALL_ODD, payout: 1 },
  even: { label: 'even', numbers: ALL_EVEN, payout: 1 },
  low: { label: '1-18', numbers: ALL_LOW, payout: 1 },
  high: { label: '19-36', numbers: ALL_HIGH, payout: 1 },
  dozen1: { label: 'dozen 1', numbers: NUMBERS_BY_DOZEN[1], payout: 2 },
  dozen2: { label: 'dozen 2', numbers: NUMBERS_BY_DOZEN[2], payout: 2 },
  dozen3: { label: 'dozen 3', numbers: NUMBERS_BY_DOZEN[3], payout: 2 },
  column1: { label: 'column 1', numbers: NUMBERS_BY_COLUMN[1], payout: 2 },
  column2: { label: 'column 2', numbers: NUMBERS_BY_COLUMN[2], payout: 2 },
  column3: { label: 'column 3', numbers: NUMBERS_BY_COLUMN[3], payout: 2 },
}

function lastNonZero(spins: Spin[]): number | undefined {
  for (let i = spins.length - 1; i >= 0; i--) {
    if (!isZero(spins[i].n)) return spins[i].n
  }
  return undefined
}

function groupCounts(spins: Spin[], window: number, groupOf: (n: number) => number): number[] {
  const counts = [0, 0, 0, 0]
  for (const s of spins.slice(-window)) counts[groupOf(s.n)]++
  return counts
}

function rankedGroups(counts: number[], desc: boolean): number[] {
  return [1, 2, 3].sort((a, b) => (desc ? counts[b] - counts[a] : counts[a] - counts[b]))
}

function groupTarget(group: 'dozen' | 'column', idx: number): ResolvedTarget {
  const table = group === 'dozen' ? NUMBERS_BY_DOZEN : NUMBERS_BY_COLUMN
  return {
    label: `${group} ${idx}`,
    numbers: table[idx],
    payout: 2,
    perNumber: false,
  }
}

function straightTarget(label: string, numbers: number[]): ResolvedTarget {
  return { label, numbers, payout: 35, perNumber: true }
}

/** Resolves a target to concrete numbers, or null when it has no answer yet. */
export function resolveTarget(
  target: TargetDef,
  spins: Spin[],
  config: SessionConfig,
): ResolvedTarget | null {
  switch (target.kind) {
    case 'fixed': {
      const t = FIXED_TARGETS[target.bet]
      return { ...t, perNumber: false }
    }
    case 'numbers': {
      if (target.numbers.length === 0) return null
      return straightTarget(
        `numbers ${target.numbers.map(labelOf).join(',')}`,
        target.numbers,
      )
    }
    case 'hotGroup': {
      const counts = groupCounts(spins, target.window, target.group === 'dozen' ? dozenOf : columnOf)
      const ranked = rankedGroups(counts, true)
      return groupTarget(target.group, ranked[target.rank - 1])
    }
    case 'coldGroup': {
      const counts = groupCounts(spins, target.window, target.group === 'dozen' ? dozenOf : columnOf)
      return groupTarget(target.group, rankedGroups(counts, false)[0])
    }
    case 'hotNumbers': {
      const freq = new Map<number, number>()
      for (const s of spins.slice(-target.window)) freq.set(s.n, (freq.get(s.n) ?? 0) + 1)
      if (freq.size === 0) return null
      const top = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, target.count)
        .map(([n]) => n)
      return straightTarget(`hot ${top.map(labelOf).join(',')}`, top)
    }
    case 'coldNumbers': {
      const pockets = pocketsFor(config.wheelType)
      const lastSeen = new Map<number, number>()
      spins.forEach((s, i) => lastSeen.set(s.n, i))
      const coldest = [...pockets]
        .sort((a, b) => (lastSeen.get(a) ?? -1) - (lastSeen.get(b) ?? -1))
        .slice(0, target.count)
      return straightTarget(`cold ${coldest.map(labelOf).join(',')}`, coldest)
    }
    case 'lastColor': {
      const last = lastNonZero(spins)
      if (last === undefined) return null
      const t = FIXED_TARGETS[colorOf(last)]
      return t ? { ...t, perNumber: false } : null
    }
    case 'oppositeLastColor': {
      const last = lastNonZero(spins)
      if (last === undefined) return null
      const t = FIXED_TARGETS[colorOf(last) === 'red' ? 'black' : 'red']
      return { ...t, perNumber: false }
    }
    case 'lastDozen': {
      const last = lastNonZero(spins)
      if (last === undefined) return null
      return groupTarget('dozen', dozenOf(last))
    }
    case 'lastColumn': {
      const last = lastNonZero(spins)
      if (last === undefined) return null
      return groupTarget('column', columnOf(last))
    }
    case 'neighbours': {
      if (spins.length === 0) return null
      const order = wheelOrder(config.wheelType)
      const idx = order.indexOf(spins[spins.length - 1].n)
      if (idx === -1) return null
      const picks: number[] = []
      for (let off = -target.span; off <= target.span; off++) {
        picks.push(order[(idx + off + order.length) % order.length])
      }
      return straightTarget(`neighbours of ${labelOf(order[idx])}`, picks)
    }
    case 'repeatLast': {
      if (spins.length === 0) return null
      const n = spins[spins.length - 1].n
      return straightTarget(`repeat ${labelOf(n)}`, [n])
    }
  }
}

const GROUP_FNS: Record<string, (n: number) => number> = {
  color: n => (isZero(n) ? 0 : colorOf(n) === 'red' ? 1 : 2),
  oddEven: n => (isZero(n) ? 0 : n % 2 === 1 ? 1 : 2),
  highLow: n => (isZero(n) ? 0 : n <= 18 ? 1 : 2),
  dozen: dozenOf,
  column: columnOf,
}

function conditionPasses(
  cond: ConditionDef,
  targetNumbers: number[],
  spins: Spin[],
): boolean {
  switch (cond.kind) {
    case 'always':
      return true
    case 'streak': {
      if (spins.length < cond.length) return false
      const fn = GROUP_FNS[cond.group]
      const recent = spins.slice(-cond.length).map(s => fn(s.n))
      return recent[0] !== 0 && recent.every(g => g === recent[0])
    }
    case 'targetSleeping': {
      if (spins.length < cond.gap) return false
      const set = new Set(targetNumbers)
      return spins.slice(-cond.gap).every(s => !set.has(s.n))
    }
    case 'targetHitting': {
      const set = new Set(targetNumbers)
      const hits = spins.slice(-cond.window).filter(s => set.has(s.n)).length
      return hits >= cond.minHits
    }
  }
}

function ruleBets(rule: BetRule, spins: Spin[], config: SessionConfig): Bet[] {
  const resolved = resolveTarget(rule.target, spins, config)
  if (!resolved) return []
  if (!conditionPasses(rule.condition, resolved.numbers, spins)) return []
  if (resolved.perNumber) {
    return resolved.numbers.map(n => ({
      label: `straight ${labelOf(n)}`,
      numbers: [n],
      payout: resolved.payout,
      units: rule.units,
    }))
  }
  return [
    {
      label: resolved.label,
      numbers: resolved.numbers,
      payout: resolved.payout,
      units: rule.units,
    },
  ]
}

/** Compiles any saved placement definition (rules, steps or GB) into a live system. */
export function buildAnyPlacementSystem(def: AnyPlacementDef): PlacementSystem {
  if (isStepPlacement(def)) return buildStepPlacementSystem(def)
  if (isGbPlacement(def)) return buildGbPlacementSystem(def)
  if (isMartiPlacement(def)) return buildMartiPlacementSystem(def)
  return buildPlacementSystem(def)
}

/** Compiles a saved rules-based placement definition into a live PlacementSystem. */
export function buildPlacementSystem(def: PlacementDef): PlacementSystem {
  return {
    id: def.id,
    name: def.name,
    description: def.description || 'Custom placement system.',
    bets: ({ spins, config }) => {
      if (spins.length < def.minSpins) return []
      return def.rules.flatMap(rule => ruleBets(rule, spins, config))
    },
  }
}
