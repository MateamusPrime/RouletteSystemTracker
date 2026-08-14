import type { MoneyManagementSystem } from '../money'
import type { SummaryFact, SystemSummary } from '../summary'
import type { MoneyDef, MoneyGuardsDef, SeqAction, StepAction } from './types'

const MIN_MULT = 0.1
const LINE_MAX_LENGTH = 24

function applyStep(current: number, start: number, action: StepAction): number {
  switch (action.op) {
    case 'reset':
      return start
    case 'hold':
      return current
    case 'add':
      return current + action.value
    case 'subtract':
      return current - action.value
    case 'multiply':
      return current * action.value
    case 'divide':
      return action.value === 0 ? current : current / action.value
  }
}

function clampMult(v: number, cap: number): number {
  return Math.min(Math.max(v, MIN_MULT), cap)
}

interface ProgressionState {
  mult: number
  winStreak: number
}

interface SequenceState {
  idx: number
}

interface CancellationState {
  line: number[]
}

function applySeq(idx: number, len: number, action: SeqAction, endBehavior: 'clamp' | 'reset'): number {
  switch (action.op) {
    case 'reset':
      return 0
    case 'hold':
      return idx
    case 'forward': {
      const next = idx + action.steps
      if (next > len - 1) return endBehavior === 'reset' ? 0 : len - 1
      return next
    }
    case 'back':
      return Math.max(idx - action.steps, 0)
  }
}

function lineStake(line: number[]): number {
  if (line.length === 0) return 1
  if (line.length === 1) return line[0]
  return line[0] + line[line.length - 1]
}

const positive = (v: number | null | undefined): v is number => v != null && v > 0

function guardsActive(g: MoneyGuardsDef | undefined): g is MoneyGuardsDef {
  if (!g) return false
  return (
    positive(g.stopWinUnits) ||
    positive(g.stopLossUnits) ||
    positive(g.cycleTargetUnits) ||
    positive(g.cycleStopLossUnits) ||
    positive(g.maxCycles) ||
    g.aheadFactor !== 1 ||
    g.behindFactor !== 1
  )
}

interface GuardedState {
  inner: unknown
  /** Session profit in units, accumulated from each spin's net result. */
  profit: number
  /** Session profit at the moment the current cycle began. */
  cycleStart: number
  /** How many bank-and-reset cycles have completed. */
  cyclesDone: number
}

/**
 * Wraps any money system with session guards:
 * - walk away at a session profit target or loss limit (multiplier 0 after),
 * - scale the stake while ahead / behind,
 * - bank-and-reset cycles: when the current cycle's profit reaches the target
 *   (or its loss limit), the staking plan resets to its opening stake and a
 *   fresh cycle begins — the engine behind "climb, bank $50, start over".
 */
function withGuards(
  system: MoneyManagementSystem<any>,
  g: MoneyGuardsDef,
  cap: number,
): MoneyManagementSystem<GuardedState> {
  const stopped = (s: GuardedState) =>
    (positive(g.stopWinUnits) && s.profit >= g.stopWinUnits) ||
    (positive(g.stopLossUnits) && s.profit <= -g.stopLossUnits) ||
    (positive(g.maxCycles) && s.cyclesDone >= g.maxCycles)

  return {
    id: system.id,
    name: system.name,
    description: system.description,
    summary: system.summary,
    initial: () => ({ inner: system.initial(), profit: 0, cycleStart: 0, cyclesDone: 0 }),
    multiplier: (s, context) => {
      if (stopped(s)) return 0
      // Pass the bankroll straight through so a wrapped proportional plan can
      // still see it under the overlay's guards.
      let m = system.multiplier(s.inner, context)
      if (s.profit > 0) m *= g.aheadFactor
      else if (s.profit < 0) m *= g.behindFactor
      return Math.min(m, cap)
    },
    next: (s, outcome, netUnits = 0) => {
      if (stopped(s)) return s
      const profit = s.profit + netUnits
      const cycleProfit = profit - s.cycleStart
      const banked = positive(g.cycleTargetUnits) && cycleProfit >= g.cycleTargetUnits
      const bustedCycle =
        positive(g.cycleStopLossUnits) && cycleProfit <= -g.cycleStopLossUnits
      if (banked || bustedCycle) {
        const cyclesDone = s.cyclesDone + 1
        // 'milestones' keeps targets on fixed multiples so an overshoot counts
        // toward the next one; 'from-cycle-start' demands a full target again.
        const nextStart =
          banked && (g.cycleBasis ?? 'milestones') === 'milestones'
            ? s.cycleStart + (g.cycleTargetUnits as number)
            : profit
        return {
          inner: system.initial(),
          profit,
          cycleStart: nextStart,
          cyclesDone,
        }
      }
      return {
        inner: system.next(s.inner, outcome, netUnits),
        profit,
        cycleStart: s.cycleStart,
        cyclesDone: s.cyclesDone,
      }
    },
  }
}

const u = (v: number) => `${parseFloat(v.toFixed(2))}u`

function stepActionText(a: StepAction): string {
  switch (a.op) {
    case 'reset':
      return 'back to the opening stake'
    case 'hold':
      return 'keep the same stake'
    case 'add':
      return `+${u(a.value)}`
    case 'subtract':
      return `−${u(a.value)}`
    case 'multiply':
      return `× ${a.value}`
    case 'divide':
      return `÷ ${a.value}`
  }
}

function seqActionText(a: SeqAction): string {
  switch (a.op) {
    case 'reset':
      return 'back to the start'
    case 'hold':
      return 'stay put'
    case 'forward':
      return `forward ${a.steps}`
    case 'back':
      return `back ${a.steps}`
  }
}

/** Plain-English progression summary, used for the hover cards and reports. */
export function describeMoneyDef(def: MoneyDef): string {
  const parts: string[] = []
  if (def.mode === 'progression') {
    parts.push(
      `Progression starting at ${u(def.start)}. After a win: ${stepActionText(def.onWin)}. After a loss: ${stepActionText(def.onLoss)}.`,
    )
    if (def.winStreakReset > 0) {
      parts.push(`Resets after ${def.winStreakReset} straight wins.`)
    }
  } else if (def.mode === 'sequence') {
    parts.push(
      `Ladder ${def.sequence.join('-')}. Win: ${seqActionText(def.onWin)}. Loss: ${seqActionText(def.onLoss)}.`,
    )
    parts.push(
      def.endBehavior === 'reset'
        ? 'Restarts at the end of the ladder.'
        : 'Holds the last stake at the end of the ladder.',
    )
  } else if (def.mode === 'cancellation') {
    parts.push(
      `Cancellation line ${def.line.join('-')}: stake the first + last entries, cross both off on a win, append the stake on a loss.`,
    )
  } else {
    parts.push(
      `Step machine: ${def.steps
        .map((s, i) => `${i + 1}) ${u(s.mult)}${s.onWin === 'stay' ? '' : ` win→${s.onWin + 1}`}${s.onLoss === 'stay' ? '' : ` loss→${s.onLoss + 1}`}`)
        .join(', ')}.`,
    )
  }
  parts.push(`Stake capped at ${u(def.cap)}.`)

  const g = def.guards
  if (g) {
    if (positive(g.cycleTargetUnits)) {
      parts.push(
        `Banks and resets each time a cycle gains ${u(g.cycleTargetUnits)} (${(g.cycleBasis ?? 'milestones') === 'milestones' ? 'fixed milestones' : 'carrying the overshoot'}).`,
      )
    }
    if (positive(g.cycleStopLossUnits)) {
      parts.push(`Abandons a cycle after losing ${u(g.cycleStopLossUnits)}.`)
    }
    if (positive(g.maxCycles)) parts.push(`Stops after ${g.maxCycles} cycles.`)
    if (positive(g.stopWinUnits)) parts.push(`Walks away at +${u(g.stopWinUnits)} profit.`)
    if (positive(g.stopLossUnits)) parts.push(`Walks away at −${u(g.stopLossUnits)}.`)
    if (g.aheadFactor !== 1) parts.push(`Stakes × ${g.aheadFactor} while ahead.`)
    if (g.behindFactor !== 1) parts.push(`Stakes × ${g.behindFactor} while behind.`)
  }
  return parts.join(' ')
}

const MODE_LABEL: Record<MoneyDef['mode'], string> = {
  progression: 'Progression',
  sequence: 'Betting ladder',
  cancellation: 'Cancellation line',
  steps: 'Step machine',
}

/** Structured breakdown of the staking plan, laid out by the hover card. */
export function summariseMoneyDef(def: MoneyDef): SystemSummary {
  const facts: SummaryFact[] = []
  if (def.mode === 'progression') {
    facts.push({ label: 'Opening stake', value: u(def.start) })
    facts.push({ label: 'After a win', value: stepActionText(def.onWin) })
    facts.push({ label: 'After a loss', value: stepActionText(def.onLoss) })
    if (def.winStreakReset > 0) {
      facts.push({ label: 'Reset after', value: `${def.winStreakReset} straight wins` })
    }
  } else if (def.mode === 'sequence') {
    facts.push({ label: 'Ladder', value: def.sequence.join(' → ') })
    facts.push({ label: 'After a win', value: seqActionText(def.onWin) })
    facts.push({ label: 'After a loss', value: seqActionText(def.onLoss) })
    facts.push({
      label: 'At the end',
      value: def.endBehavior === 'reset' ? 'restart the ladder' : 'hold the last stake',
    })
  } else if (def.mode === 'cancellation') {
    facts.push({ label: 'Starting line', value: def.line.join(' · ') })
    facts.push({ label: 'Stake', value: 'first + last of the line' })
    facts.push({ label: 'On a win', value: 'cross both off' })
    facts.push({ label: 'On a loss', value: 'append the stake' })
  } else {
    for (const [i, s] of def.steps.entries()) {
      facts.push({
        label: `Step ${i + 1}`,
        value: `${u(s.mult)} · win ${s.onWin === 'stay' ? 'stay' : `→ ${s.onWin + 1}`} · loss ${s.onLoss === 'stay' ? 'stay' : `→ ${s.onLoss + 1}`}`,
      })
    }
  }
  facts.push({ label: 'Stake cap', value: u(def.cap) })

  const g = def.guards
  if (g) {
    if (positive(g.cycleTargetUnits)) {
      facts.push({
        label: 'Bank & reset',
        value: `every ${u(g.cycleTargetUnits)} of cycle profit (${(g.cycleBasis ?? 'milestones') === 'milestones' ? 'fixed milestones' : 'carrying overshoot'})`,
      })
    }
    if (positive(g.cycleStopLossUnits)) {
      facts.push({ label: 'Abandon cycle at', value: `−${u(g.cycleStopLossUnits)}` })
    }
    if (positive(g.maxCycles)) facts.push({ label: 'Stop after', value: `${g.maxCycles} cycles` })
    if (positive(g.stopWinUnits)) {
      facts.push({ label: 'Walk away at', value: `+${u(g.stopWinUnits)} profit` })
    }
    if (positive(g.stopLossUnits)) {
      facts.push({ label: 'Stop loss', value: `−${u(g.stopLossUnits)}` })
    }
    if (g.aheadFactor !== 1) facts.push({ label: 'While ahead', value: `stake × ${g.aheadFactor}` })
    if (g.behindFactor !== 1) facts.push({ label: 'While behind', value: `stake × ${g.behindFactor}` })
  }

  return {
    badge: MODE_LABEL[def.mode],
    intro: def.description || undefined,
    facts,
  }
}

/** Compiles a saved money-management definition into a live system. */
export function buildMoneySystem(def: MoneyDef): MoneyManagementSystem<any> {
  const inner = buildBaseMoneySystem(def)
  const described: MoneyManagementSystem<any> = {
    ...inner,
    description: [def.description, describeMoneyDef(def)].filter(Boolean).join(' — '),
    summary: summariseMoneyDef(def),
  }
  return guardsActive(def.guards) ? withGuards(described, def.guards, def.cap) : described
}

function buildBaseMoneySystem(def: MoneyDef): MoneyManagementSystem<any> {
  const base = {
    id: def.id,
    name: def.name,
    description: def.description || 'Custom money management system.',
  }

  if (def.mode === 'progression') {
    const system: MoneyManagementSystem<ProgressionState> = {
      ...base,
      initial: () => ({ mult: def.start, winStreak: 0 }),
      multiplier: s => clampMult(s.mult, def.cap),
      next: (s, outcome) => {
        if (outcome === 'push') return s
        if (outcome === 'win') {
          const winStreak = s.winStreak + 1
          if (def.winStreakReset > 0 && winStreak >= def.winStreakReset) {
            return { mult: def.start, winStreak: 0 }
          }
          return {
            mult: clampMult(applyStep(s.mult, def.start, def.onWin), def.cap),
            winStreak,
          }
        }
        return {
          mult: clampMult(applyStep(s.mult, def.start, def.onLoss), def.cap),
          winStreak: 0,
        }
      },
    }
    return system
  }

  if (def.mode === 'steps') {
    const steps = def.steps.length > 0 ? def.steps : [{ mult: 1, onWin: 'stay' as const, onLoss: 'stay' as const }]
    const jump = (idx: number, to: number | 'stay') =>
      to === 'stay' ? idx : Math.min(Math.max(to, 0), steps.length - 1)
    const system: MoneyManagementSystem<SequenceState> = {
      ...base,
      initial: () => ({ idx: 0 }),
      multiplier: s => clampMult(steps[Math.min(s.idx, steps.length - 1)].mult, def.cap),
      next: (s, outcome) => {
        if (outcome === 'push') return s
        const step = steps[Math.min(s.idx, steps.length - 1)]
        return { idx: jump(s.idx, outcome === 'win' ? step.onWin : step.onLoss) }
      },
    }
    return system
  }

  if (def.mode === 'sequence') {
    const seq = def.sequence.length > 0 ? def.sequence : [1]
    const system: MoneyManagementSystem<SequenceState> = {
      ...base,
      initial: () => ({ idx: 0 }),
      multiplier: s => clampMult(seq[Math.min(s.idx, seq.length - 1)], def.cap),
      next: (s, outcome) => {
        if (outcome === 'push') return s
        const action = outcome === 'win' ? def.onWin : def.onLoss
        return { idx: applySeq(s.idx, seq.length, action, def.endBehavior) }
      },
    }
    return system
  }

  // Cancellation (Labouchere-style) with a user-defined starting line.
  const startLine = def.line.length > 0 ? def.line : [1, 2, 3, 4]
  const system: MoneyManagementSystem<CancellationState> = {
    ...base,
    initial: () => ({ line: [...startLine] }),
    multiplier: s => clampMult(lineStake(s.line), def.cap),
    next: (s, outcome) => {
      if (outcome === 'push') return s
      const line = s.line.length === 0 ? [...startLine] : [...s.line]
      const stake = lineStake(line)
      if (outcome === 'win') {
        line.shift()
        line.pop()
        return { line: line.length === 0 ? [...startLine] : line }
      }
      if (line.length < LINE_MAX_LENGTH) line.push(stake)
      return { line }
    },
  }
  return system
}
