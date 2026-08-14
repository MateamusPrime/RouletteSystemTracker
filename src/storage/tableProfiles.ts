import type { SessionConfig, WheelType } from '../domain/types'

/**
 * Named table limit presets, so a regular table's rules are entered once
 * rather than re-typed for every session.
 */
export interface TableProfile {
  id: string
  name: string
  wheelType: WheelType
  tableMin: number
  tableMaxOutside: number
  tableMaxInside: number
  /** Per-payout ceilings, as online tables quote them. Absent on older saves. */
  tableMaxByPayout?: Record<string, number>
}

const KEY = 'roulette-tracker:table-profiles'

/** Sensible starting points covering the usual shapes of table. */
export const DEFAULT_PROFILES: TableProfile[] = [
  {
    id: 'builtin-low',
    name: 'Low stakes ($5 min)',
    wheelType: 'european',
    tableMin: 5,
    tableMaxOutside: 500,
    tableMaxInside: 100,
  },
  {
    id: 'builtin-mid',
    name: 'Mid stakes ($25 min)',
    wheelType: 'european',
    tableMin: 25,
    tableMaxOutside: 5000,
    tableMaxInside: 500,
  },
  {
    id: 'builtin-high',
    name: 'High limit ($100 min)',
    wheelType: 'european',
    tableMin: 100,
    tableMaxOutside: 25000,
    tableMaxInside: 2500,
  },
  {
    id: 'builtin-american',
    name: 'American $10 min',
    wheelType: 'american',
    tableMin: 10,
    tableMaxOutside: 1000,
    tableMaxInside: 200,
  },
]

export function loadTableProfiles(): TableProfile[] {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as TableProfile[]) : []
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export function saveTableProfiles(profiles: TableProfile[]): void {
  localStorage.setItem(KEY, JSON.stringify(profiles))
}

/** Built-ins first, then whatever the user has saved. */
export function allTableProfiles(): TableProfile[] {
  return [...DEFAULT_PROFILES, ...loadTableProfiles()]
}

/** Compares two per-payout maps, treating absent and 0 as the same thing. */
function sameTiers(a?: Record<string, number>, b?: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const k of keys) if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false
  return true
}

export function applyProfile(config: SessionConfig, profile: TableProfile): SessionConfig {
  return {
    ...config,
    wheelType: profile.wheelType,
    tableMin: profile.tableMin,
    tableMaxOutside: profile.tableMaxOutside,
    tableMaxInside: profile.tableMaxInside,
    tableMaxByPayout: { ...(profile.tableMaxByPayout ?? {}) },
  }
}

/** True when the session's limits already match the profile exactly. */
export function profileMatches(config: SessionConfig, profile: TableProfile): boolean {
  return (
    (config.tableMin ?? 0) === profile.tableMin &&
    (config.tableMaxOutside ?? 0) === profile.tableMaxOutside &&
    (config.tableMaxInside ?? 0) === profile.tableMaxInside &&
    sameTiers(config.tableMaxByPayout, profile.tableMaxByPayout) &&
    config.wheelType === profile.wheelType
  )
}

export function profileFromConfig(name: string, config: SessionConfig): TableProfile {
  return {
    id: `table-${crypto.randomUUID()}`,
    name,
    wheelType: config.wheelType,
    tableMin: config.tableMin ?? 0,
    tableMaxOutside: config.tableMaxOutside ?? 0,
    tableMaxInside: config.tableMaxInside ?? 0,
    tableMaxByPayout: { ...(config.tableMaxByPayout ?? {}) },
  }
}
