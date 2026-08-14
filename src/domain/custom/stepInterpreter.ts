import {
  ALL_BLACK,
  ALL_EVEN,
  ALL_HIGH,
  ALL_LOW,
  ALL_ODD,
  ALL_RED,
  DOUBLE_ZERO,
  NUMBERS_BY_COLUMN,
  NUMBERS_BY_DOZEN,
  labelOf,
} from '../roulette'
import type { Bet, Spin } from '../types'
import type { PlacementSystem } from '../placement'
import type { SystemSummary } from '../summary'
import type { FixedBetKind, StepBetDef, StepDef, StepNext, StepPlacementDef } from './types'

/**
 * Step systems are deterministic state machines over the spin outcomes, so the
 * current step never needs to be stored: it is re-derived by replaying the
 * recorded spins. That keeps step systems compatible with the stateless
 * PlacementSystem interface (and with editing history via Undo).
 *
 * Semantics:
 * - Each StepBetDef is ONE logical bet for transition purposes ("2 of 3 bets
 *   hit"), even when it is a spread over many straight-up numbers.
 * - For money, a numbers spread is staked per number (misses lose), so it is
 *   expanded into individual straight-up bets.
 */

export const FIXED_BET_INFO: Record<FixedBetKind, { label: string; numbers: number[]; payout: number }> = {
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

interface StepState {
  stepIdx: number
  /** Budget in units for a carry-funded step; null when the step is fixed-funded. */
  carryBudget: number | null
  /** Completed cycles so far — incremented every time the machine restarts. */
  cycles: number
}

const START: StepState = { stepIdx: 0, carryBudget: null, cycles: 0 }

/** Numbers covered by one logical bet (for hit detection). */
function coveredNumbers(bet: StepBetDef): number[] {
  return bet.target.kind === 'fixed' ? FIXED_BET_INFO[bet.target.bet].numbers : bet.target.numbers
}

/** Payout for an inside combo bet: split 17:1, street 11:1, corner 8:1, six line 5:1. */
export function comboPayout(count: number): number {
  return Math.floor(36 / count) - 1
}

const COMBO_NAMES: Record<number, string> = {
  1: 'straight up',
  2: 'split',
  3: 'street',
  4: 'corner',
  6: 'six line',
}

export function comboLabel(numbers: number[]): string {
  const name = COMBO_NAMES[numbers.length] ?? `${numbers.length}-number bet`
  return `${name} ${numbers.map(labelOf).join('-')}`
}

/**
 * Weight of a logical bet when splitting a carry budget: a numbers spread
 * needs stake for EVERY number, so its weight scales with the spread size.
 * A combo bet is one chip regardless of coverage.
 */
function betWeight(bet: StepBetDef): number {
  return bet.target.kind === 'numbers' ? bet.units * bet.target.numbers.length : bet.units
}

/** Expands one logical bet into concrete felt bets, staking `totalUnits` across it. */
function expandBet(bet: StepBetDef, totalUnits: number): Bet[] {
  if (bet.target.kind === 'fixed') {
    const info = FIXED_BET_INFO[bet.target.bet]
    return [{ label: info.label, numbers: info.numbers, payout: info.payout, units: totalUnits }]
  }
  const nums = bet.target.numbers
  if (nums.length === 0) return []
  if (bet.target.kind === 'combo') {
    return [
      {
        label: comboLabel(nums),
        numbers: nums,
        payout: comboPayout(nums.length),
        units: totalUnits,
      },
    ]
  }
  const per = totalUnits / nums.length
  return nums.map(n => ({ label: `straight ${labelOf(n)}`, numbers: [n], payout: 35, units: per }))
}

/** Concrete bets a step places, given its carry budget (null = fixed funding). */
function stepBets(step: StepDef, carryBudget: number | null): Bet[] {
  const valid = step.bets.filter(b => coveredNumbers(b).length > 0)
  if (valid.length === 0) return []

  if (step.funding.type === 'carry') {
    const budget = carryBudget ?? 0
    if (budget <= 0) return []
    const totalWeight = valid.reduce((s, b) => s + betWeight(b), 0)
    return valid.flatMap(b => expandBet(b, (budget * betWeight(b)) / totalWeight))
  }

  return valid.flatMap(b => expandBet(b, betWeight(b)))
}

function destination(step: StepDef, hitCount: number): StepNext {
  const next = step.next[Math.min(hitCount, step.next.length - 1)]
  return next ?? 'restart'
}

/** Advances the machine by one resolved spin. */
function advance(def: StepPlacementDef, state: StepState, spinN: number): StepState {
  /** Back to the opening bet — that completes a cycle. */
  const restart = (): StepState => ({
    stepIdx: 0,
    carryBudget: null,
    cycles: state.cycles + 1,
  })
  const step = def.steps[state.stepIdx]
  if (!step) return restart()
  const bets = stepBets(step, state.carryBudget)
  if (bets.length === 0) return restart()

  // Money resolution (per concrete bet). Net = profit; gross = stakes
  // returned + winnings (what a player physically picks up off the felt).
  let netUnits = 0
  let grossUnits = 0
  for (const bet of bets) {
    if (bet.numbers.includes(spinN)) {
      netUnits += bet.units * bet.payout
      grossUnits += bet.units * (bet.payout + 1)
    } else {
      netUnits -= bet.units
    }
  }

  // Transition resolution (per logical bet). An exact winner-set override in
  // outcomeNext beats the hit-count rule.
  const winnerLabels = step.bets
    .filter(b => coveredNumbers(b).includes(spinN))
    .map(stepBetLabel)
  const hitCount = winnerLabels.length
  const dest =
    step.outcomeNext?.[outcomeKey(winnerLabels)] ?? destination(step, hitCount)
  if (dest === 'restart') return restart()
  const nextStep = def.steps[dest]
  if (!nextStep) return restart()

  if (nextStep.funding.type === 'carry') {
    const incoming = (nextStep.funding.basis ?? 'net') === 'gross' ? grossUnits : netUnits
    const budget = incoming - nextStep.funding.pocketUnits
    // Nothing left to play with after pocketing → back to the top.
    if (budget <= 0) return restart()
    return { stepIdx: dest, carryBudget: budget, cycles: state.cycles }
  }
  // Landing back on the opening step also closes out a cycle.
  return {
    stepIdx: dest,
    carryBudget: null,
    cycles: dest === 0 ? state.cycles + 1 : state.cycles,
  }
}

export function currentStepState(def: StepPlacementDef, spins: Spin[]): StepState {
  let state: StepState = START
  for (const s of spins) state = advance(def, state, s.n)
  return state
}

/** Plain-English walkthrough of the machine, for hover cards and reports. */
export function describeStepSystem(def: StepPlacementDef): string {
  const stepName = (i: number) => def.steps[i]?.name || `Step ${i + 1}`
  const lines = def.steps.map((s, i) => {
    const funding =
      s.funding.type === 'carry'
        ? `, funded by carrying the previous win${s.funding.pocketUnits > 0 ? ` after pocketing ${parseFloat(s.funding.pocketUnits.toFixed(2))}u` : ''}`
        : ''
    const routes = s.next
      .map((d, k) => `${k} hit${k === 1 ? '' : 's'} → ${d === 'restart' ? 'restart' : stepName(d)}`)
      .join(', ')
    return `${i + 1}) ${stepName(i)}: ${describeStepBets(s)}${funding}. ${routes}.`
  })
  return `${def.steps.length}-step machine. ${lines.join(' ')}`
}

/** Structured breakdown of the machine, laid out by the hover card. */
export function summariseStepSystem(def: StepPlacementDef): SystemSummary {
  const stepName = (i: number) => def.steps[i]?.name || `Step ${i + 1}`
  const unit = (v: number) => `${parseFloat(v.toFixed(2))}u`
  return {
    badge: `Step system · ${def.steps.length} step${def.steps.length === 1 ? '' : 's'}`,
    intro: def.description || undefined,
    steps: def.steps.map((s, i) => ({
      name: stepName(i),
      bets: s.bets.map(stepBetLabel),
      funding:
        s.funding.type === 'carry'
          ? s.funding.pocketUnits > 0
            ? `carries the win, pockets ${unit(s.funding.pocketUnits)} first`
            : 'carries the previous win'
          : undefined,
      routes: s.next.slice(0, s.bets.length + 1).map((d, k) => ({
        when: `${k} of ${s.bets.length}`,
        then: d === 'restart' ? 'restart' : stepName(d),
        isRestart: d === 'restart',
      })),
    })),
  }
}

/** Compiles a step placement definition into a live PlacementSystem. */
export function buildStepPlacementSystem(def: StepPlacementDef): PlacementSystem {
  // Replaying the whole history on every spin makes a session quadratic. The
  // simulator feeds one array that only ever grows, so remember where we got
  // to and advance from there; anything else falls back to a full replay.
  let cachedRef: readonly Spin[] | null = null
  let cachedLen = 0
  let cachedState: StepState = START

  const stateFor = (spins: Spin[]): StepState => {
    if (cachedRef !== spins || cachedLen > spins.length) {
      cachedRef = spins
      cachedLen = 0
      cachedState = START
    }
    while (cachedLen < spins.length) {
      cachedState = advance(def, cachedState, spins[cachedLen].n)
      cachedLen++
    }
    return cachedState
  }

  return {
    id: def.id,
    name: def.name,
    description: [def.description, describeStepSystem(def)].filter(Boolean).join(' — '),
    // Step systems escalate their own stakes, so they run "as designed" on
    // flat betting and any overlay is applied per completed cycle.
    selfManaged: true,
    summary: summariseStepSystem(def),
    cycleCount: ({ spins }) => stateFor(spins).cycles,
    bets: ({ spins }) => {
      if (def.steps.length === 0) return []
      const state = stateFor(spins)
      const step = def.steps[state.stepIdx]
      if (!step) return []
      const stepName = step.name || `Step ${state.stepIdx + 1}`
      return stepBets(step, state.carryBudget).map(b => ({
        ...b,
        label: `[${stepName}] ${b.label}`,
      }))
    },
  }
}

/** Total units a step's board stakes (numbers spreads stake per number). */
export function placedUnits(step: StepDef): number {
  return step.bets.reduce((s, b) => s + betWeight(b), 0)
}

/** Display label for one logical bet on a step's board. */
export function stepBetLabel(bet: StepBetDef): string {
  if (bet.target.kind === 'fixed') return FIXED_BET_INFO[bet.target.bet].label
  if (bet.target.kind === 'combo') return comboLabel(bet.target.numbers)
  return `${bet.target.numbers.length}-number spread`
}

/** Stable identity of a winner set, used for per-outcome transition overrides. */
export function outcomeKey(winners: string[]): string {
  return [...winners].sort().join('|')
}

/** One distinct resolution of a step: which logical bets win, and the money. */
export interface StepOutcome {
  hits: number
  /** Labels of the winning logical bets (empty = all miss). */
  winners: string[]
  /** Sorted-label key for outcomeNext overrides. */
  key: string
  /** Profit in units (losing stakes subtracted). */
  net: number
  /** Stakes returned + winnings, in units — what is physically picked up. */
  gross: number
}

/**
 * Every distinct outcome a step's board can produce, computed by checking
 * each pocket on the wheel and de-duplicating by winning-bet set. Powers the
 * transition labels, the incoming-win display, and the outcome picker.
 */
export function stepOutcomes(step: StepDef): StepOutcome[] {
  const byWinners = new Map<string, StepOutcome>()
  const pockets = [...Array.from({ length: 37 }, (_, i) => i), DOUBLE_ZERO]
  for (const p of pockets) {
    const winners: string[] = []
    let net = 0
    let gross = 0
    for (const b of step.bets) {
      const nums = coveredNumbers(b)
      if (nums.length === 0) continue
      const hit = nums.includes(p)
      if (hit) winners.push(stepBetLabel(b))
      if (b.target.kind === 'fixed') {
        const payout = FIXED_BET_INFO[b.target.bet].payout
        net += hit ? b.units * payout : -b.units
        gross += hit ? b.units * (payout + 1) : 0
      } else if (b.target.kind === 'combo') {
        const payout = comboPayout(nums.length)
        net += hit ? b.units * payout : -b.units
        gross += hit ? b.units * (payout + 1) : 0
      } else {
        // Per-number staking: one number wins 35:1, the rest of the spread loses.
        net += hit ? b.units * 35 - b.units * (nums.length - 1) : -b.units * nums.length
        gross += hit ? b.units * 36 : 0
      }
    }
    const key = outcomeKey(winners)
    if (!byWinners.has(key)) {
      byWinners.set(key, {
        hits: winners.length,
        winners,
        key,
        net: Math.round(net * 100) / 100,
        gross: Math.round(gross * 100) / 100,
      })
    }
  }
  return [...byWinners.values()].sort((a, b) => a.hits - b.hits || a.net - b.net)
}

/**
 * For every possible hit count of a step, the distinct net wins (in units)
 * that count can produce.
 */
export function netsByHitCount(step: StepDef): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const o of stepOutcomes(step)) {
    const list = out.get(o.hits) ?? []
    if (!list.includes(o.net)) list.push(o.net)
    out.set(o.hits, list)
  }
  for (const list of out.values()) list.sort((a, b) => a - b)
  return out
}

export function formatNets(nets: number[] | undefined): string {
  if (!nets || nets.length === 0) return ''
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(2)}u`
  return nets.map(fmt).join(' / ')
}

/** Human-readable summary of a step's board, for lists and dropdowns. */
export function describeStepBets(step: StepDef): string {
  if (step.bets.length === 0) return 'no bets'
  return step.bets
    .map(b => {
      if (b.target.kind === 'fixed') return FIXED_BET_INFO[b.target.bet].label
      if (b.target.kind === 'combo') return comboLabel(b.target.numbers)
      return `${b.target.numbers.length} straight number${b.target.numbers.length === 1 ? '' : 's'}`
    })
    .join(' + ')
}
