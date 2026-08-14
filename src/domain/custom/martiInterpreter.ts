import type { PlacementSystem } from '../placement'
import { colorOf, columnOf, dozenOf, isZero } from '../roulette'
import type { SystemSummary } from '../summary'
import type { Bet, Spin } from '../types'
import { GB_BET_INFO } from './gbInterpreter'
import type { GbLegKind, MartiFamily, MartiPlacementDef } from './types'

/**
 * Marti GB: one number on the board defines the legs. Its color, parity, half,
 * dozen and column each become an independent bet with its own money
 * management, all sharing one bankroll.
 *
 * The round is what makes it different from a plain GB: a leg that WINS stands
 * down and is not re-bet until every other leg has won too. When the last one
 * lands, the round is over and all the legs come back on the opening stake.
 */

export interface MartiLeg {
  /** Outside box, or null for the anchor number played straight up. */
  kind: GbLegKind | null
  label: string
  family: MartiFamily | 'straight'
  numbers: number[]
  payout: number
}

/** The legs a given anchor number pulls in, in felt order. */
export function martiLegs(def: MartiPlacementDef): MartiLeg[] {
  const n = def.anchor
  if (isZero(n) || n < 1 || n > 36) return []
  const wanted = new Set(def.families)
  const legs: MartiLeg[] = []
  const add = (family: MartiFamily, kind: GbLegKind) => {
    if (!wanted.has(family)) return
    const info = GB_BET_INFO[kind]
    legs.push({
      kind,
      label: info.label,
      family,
      numbers: info.numbers,
      payout: info.payout,
    })
  }
  add('color', colorOf(n) === 'red' ? 'red' : 'black')
  add('parity', n % 2 === 1 ? 'odd' : 'even')
  add('half', n <= 18 ? 'low' : 'high')
  add('dozen', (`dozen${dozenOf(n)}`) as GbLegKind)
  add('column', (`column${columnOf(n)}`) as GbLegKind)
  if (def.includeStraight) {
    // The anchor itself, at 35:1 — the leg that pays for all the others.
    legs.push({
      kind: null,
      label: `straight ${n}`,
      family: 'straight',
      numbers: [n],
      payout: 35,
    })
  }
  return legs
}

interface RoundState {
  /** How many rounds have finished — also the key that resets progressions. */
  round: number
  /** Legs that have already won inside the current round. */
  done: Set<string>
}

/** Replays the history to work out which legs are still live. */
export function currentRound(def: MartiPlacementDef, spins: Spin[]): RoundState {
  const legs = martiLegs(def)
  const state: RoundState = { round: 0, done: new Set() }
  if (legs.length === 0) return state
  for (const spin of spins) {
    for (const leg of legs) {
      if (!state.done.has(leg.label) && leg.numbers.includes(spin.n)) {
        state.done.add(leg.label)
      }
    }
    if (state.done.size === legs.length) {
      // Every leg has landed: bank the round and start the next one clean.
      state.round++
      state.done = new Set()
    }
  }
  return state
}

export function summariseMartiSystem(def: MartiPlacementDef): SystemSummary {
  const legs = martiLegs(def)
  return {
    badge: `Marti GB · number ${def.anchor}`,
    intro: def.description || undefined,
    facts: [
      { label: 'Anchor number', value: String(def.anchor) },
      ...legs.map(l => ({ label: l.family, value: `${l.label} · ${parseFloat(def.units.toFixed(2))}u` })),
      {
        label: 'Between rounds',
        value: def.resetEachRound ? 'progressions reset' : 'progressions carry over',
      },
    ],
    note:
      'A leg that wins stands down until every leg has won; then the round restarts with all legs back on the opening bet. Each leg keeps its own progression off the shared bankroll.',
  }
}

/** Compiles a saved Marti GB definition into a live PlacementSystem. */
export function buildMartiPlacementSystem(def: MartiPlacementDef): PlacementSystem {
  const legs = martiLegs(def)
  return {
    id: def.id,
    name: def.name,
    description: [
      def.description,
      `Marti GB on ${def.anchor}: ${legs.map(l => l.label).join(', ')}. Each leg runs its own progression off the shared bankroll; a leg that wins waits for every other leg before it is re-bet.`,
    ]
      .filter(Boolean)
      .join(' — '),
    summary: summariseMartiSystem(def),
    bets: ({ spins }) => {
      if (legs.length === 0) return []
      const state = currentRound(def, spins)
      return legs
        .filter(leg => !state.done.has(leg.label))
        .map((leg): Bet => ({
          label: leg.label,
          numbers: leg.numbers,
          payout: leg.payout,
          units: def.units,
          // Tagging the leg with the round number gives each round a fresh
          // progression, which is what "rebet the initial bet" means.
          leg: def.resetEachRound ? `${leg.label}#${state.round}` : leg.label,
        }))
    },
  }
}
