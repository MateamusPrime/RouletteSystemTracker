import type { PlacementSystem } from '../placement'
import {
  ALL_BLACK,
  ALL_EVEN,
  ALL_HIGH,
  ALL_LOW,
  ALL_ODD,
  ALL_RED,
  NUMBERS_BY_COLUMN,
  NUMBERS_BY_DOZEN,
} from '../roulette'
import type { SystemSummary } from '../summary'
import type { Bet, Spin } from '../types'
import { comboLabel, comboPayout } from './stepInterpreter'
import { gbLegTarget } from './types'
import type { GbLegDef, GbLegKind, GbPlacementDef, GbTrigger } from './types'

/**
 * GB systems run several independent legs at once. Each leg waits for its own
 * trigger, then bets with its own money-management progression — the engine
 * keys that off `Bet.leg` — while every leg draws on one shared bankroll.
 */

export const GB_BET_INFO: Record<GbLegKind, { label: string; numbers: number[]; payout: number }> = {
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

/** Every leg a GB system can watch, in the order they read on the felt. */
export const GB_BET_ORDER: GbLegKind[] = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'column1',
  'column2',
  'column3',
]

/** What a leg covers, whatever shape it was saved in. */
export function legInfo(leg: GbLegDef): { label: string; numbers: number[]; payout: number } {
  const target = gbLegTarget(leg)
  if (target.kind === 'fixed') return GB_BET_INFO[target.bet]
  return {
    label: comboLabel(target.numbers),
    numbers: target.numbers,
    payout: comboPayout(target.numbers.length),
  }
}

/** Zeros never belong to an outside bet, so they miss every outside leg. */
function coversNumber(numbers: number[], n: number): boolean {
  return numbers.includes(n)
}

function triggerFires(trigger: GbTrigger, numbers: number[], spins: Spin[]): boolean {
  switch (trigger.kind) {
    case 'always':
      return true
    case 'asleep': {
      const wait = Math.max(1, trigger.spins)
      if (spins.length < wait) return false
      // Only the last `wait` spins matter, which keeps this constant-time.
      for (let i = spins.length - 1; i >= 0 && spins.length - i <= wait; i--) {
        if (coversNumber(numbers, spins[i].n)) return false
      }
      return true
    }
    case 'hot': {
      const window = Math.max(1, trigger.window)
      if (spins.length < window) return false
      let hits = 0
      for (let i = spins.length - 1; i >= 0 && spins.length - i <= window; i--) {
        if (coversNumber(numbers, spins[i].n)) hits++
      }
      return hits >= trigger.times
    }
  }
}

export function describeTrigger(trigger: GbTrigger): string {
  switch (trigger.kind) {
    case 'always':
      return 'every spin'
    case 'asleep':
      return `asleep ${trigger.spins}+`
    case 'hot':
      return `${trigger.times}+ in ${trigger.window}`
  }
}

function legBet(leg: GbLegDef): Bet {
  const info = legInfo(leg)
  return {
    label: info.label,
    numbers: info.numbers,
    payout: info.payout,
    units: leg.units,
    // The leg id is what keeps each progression independent in the simulator.
    leg: info.label,
  }
}

export function summariseGbSystem(def: GbPlacementDef): SystemSummary {
  return {
    badge: `GB · ${def.legs.length} independent leg${def.legs.length === 1 ? '' : 's'}`,
    intro: def.description || undefined,
    facts: def.legs.map(leg => ({
      label: legInfo(leg).label,
      value: `${describeTrigger(leg.trigger)} · ${parseFloat(leg.units.toFixed(2))}u`,
    })),
    note:
      'Each leg runs its own money-management progression; all of them draw on the same bankroll.',
  }
}

/** Compiles a saved GB definition into a live PlacementSystem. */
export function buildGbPlacementSystem(def: GbPlacementDef): PlacementSystem {
  return {
    id: def.id,
    name: def.name,
    description:
      [
        def.description,
        `GB system watching ${def.legs.length} leg(s): ${def.legs
          .map(l => `${legInfo(l).label} (${describeTrigger(l.trigger)})`)
          .join(', ')}. Each leg carries its own progression off the shared bankroll.`,
      ]
        .filter(Boolean)
        .join(' — '),
    summary: summariseGbSystem(def),
    bets: ({ spins }) =>
      def.legs
        .filter(leg => triggerFires(leg.trigger, legInfo(leg).numbers, spins))
        .map(legBet),
  }
}
