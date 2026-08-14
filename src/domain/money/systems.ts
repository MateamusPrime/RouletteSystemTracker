import type { SummaryFact } from '../summary'
import type { MoneyManagementSystem } from './types'

// Progressions are capped so a long losing run cannot demand an absurd stake.
const MAX_MULTIPLIER = 256

/** Builds the structured hover-card summary shared by the built-in plans. */
function summary(badge: string, facts: SummaryFact[]) {
  return { badge, facts: [...facts, { label: 'Stake cap', value: `${MAX_MULTIPLIER}u` }] }
}

export const flat: MoneyManagementSystem<null> = {
  id: 'flat',
  name: 'Flat Betting',
  description: 'Same stake every spin. The baseline.',
  summary: {
    badge: 'Flat',
    intro: 'The baseline every other plan is measured against.',
    facts: [
      { label: 'Opening stake', value: '1u' },
      { label: 'After a win', value: 'unchanged' },
      { label: 'After a loss', value: 'unchanged' },
    ],
  },
  initial: () => null,
  multiplier: () => 1,
  next: s => s,
}

export const martingale: MoneyManagementSystem<{ level: number }> = {
  id: 'martingale',
  name: 'Martingale',
  description: 'Double after every loss, reset after a win.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: 'back to 1u' },
    { label: 'After a loss', value: '× 2' },
  ]),
  initial: () => ({ level: 0 }),
  multiplier: ({ level }) => Math.min(2 ** level, MAX_MULTIPLIER),
  next: (s, outcome) => {
    if (outcome === 'loss') return { level: s.level + 1 }
    if (outcome === 'win') return { level: 0 }
    return s
  },
}

/**
 * Martingale plus a unit each step. Where Martingale only claws back what the
 * losing run cost, this books a unit of profit for every step of it — at the
 * price of a stake that climbs noticeably faster.
 */
export const grandMartingale: MoneyManagementSystem<{ level: number }> = {
  id: 'grand-martingale',
  name: 'Grand Martingale',
  description: 'Double AND add a unit after every loss, reset after a win.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: 'back to 1u' },
    { label: 'After a loss', value: '× 2, + 1u' },
    { label: 'Ladder', value: '1 → 3 → 7 → 15 → 31 …' },
  ]),
  initial: () => ({ level: 0 }),
  // 2^(n+1) - 1 is the closed form of doubling-and-adding-one from 1.
  multiplier: ({ level }) => Math.min(2 ** (level + 1) - 1, MAX_MULTIPLIER),
  next: (s, outcome) => {
    if (outcome === 'loss') return { level: s.level + 1 }
    if (outcome === 'win') return { level: 0 }
    return s
  },
}

/**
 * The recovery ladder the "All on Black" channel says it prefers: triple for
 * the first two escalations to claw back faster, then settle into ordinary
 * doubling until the run is recovered.
 */
export const threeThenTwoRecovery: MoneyManagementSystem<{ level: number }> = {
  id: 'recovery-3x-2x',
  name: '3x/2x Recovery',
  description: 'Triple on the first two losses for a fast recovery, then double on each loss after that. A win resets to the opening stake.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'First two losses', value: '× 3' },
    { label: 'Later losses', value: '× 2' },
    { label: 'After a win', value: 'back to 1u' },
    { label: 'Ladder', value: '1 → 3 → 9 → 18 → 36 …' },
  ]),
  initial: () => ({ level: 0 }),
  multiplier: ({ level }) => {
    // 1, 3, 9 then doubling: 18, 36, 72 …
    const raw = level <= 2 ? 3 ** level : 9 * 2 ** (level - 2)
    return Math.min(raw, MAX_MULTIPLIER)
  },
  next: (s, outcome) => {
    if (outcome === 'loss') return { level: s.level + 1 }
    if (outcome === 'win') return { level: 0 }
    return s
  },
}

export const paroli: MoneyManagementSystem<{ streak: number }> = {
  id: 'paroli',
  name: 'Paroli (Reverse Martingale)',
  description: 'Double after a win, reset after 3 straight wins or any loss.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: '× 2' },
    { label: 'After a loss', value: 'back to 1u' },
    { label: 'Reset after', value: '3 straight wins' },
  ]),
  initial: () => ({ streak: 0 }),
  multiplier: ({ streak }) => 2 ** streak,
  next: (s, outcome) => {
    if (outcome === 'win') return { streak: s.streak >= 2 ? 0 : s.streak + 1 }
    if (outcome === 'loss') return { streak: 0 }
    return s
  },
}

export const dalembert: MoneyManagementSystem<{ level: number }> = {
  id: 'dalembert',
  name: "D'Alembert",
  description: 'Add one unit after a loss, remove one after a win.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: '− 1u' },
    { label: 'After a loss', value: '+ 1u' },
  ]),
  initial: () => ({ level: 0 }),
  multiplier: ({ level }) => level + 1,
  next: (s, outcome) => {
    if (outcome === 'loss') return { level: Math.min(s.level + 1, MAX_MULTIPLIER - 1) }
    if (outcome === 'win') return { level: Math.max(s.level - 1, 0) }
    return s
  },
}

export const dalembertReset: MoneyManagementSystem<{ level: number }> = {
  id: 'dalembert-reset',
  name: "D'Alembert (reset on win)",
  description: 'Add one unit after a loss; a win drops all the way back to the opening stake.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: 'back to 1u' },
    { label: 'After a loss', value: '+ 1u' },
  ]),
  initial: () => ({ level: 0 }),
  multiplier: ({ level }) => level + 1,
  next: (s, outcome) => {
    if (outcome === 'loss') return { level: Math.min(s.level + 1, MAX_MULTIPLIER - 1) }
    if (outcome === 'win') return { level: 0 }
    return s
  },
}

export const reverseDalembert: MoneyManagementSystem<{ level: number }> = {
  id: 'reverse-dalembert',
  name: "Reverse D'Alembert",
  description: 'Add one unit after a win, remove one after a loss.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: '+ 1u' },
    { label: 'After a loss', value: '− 1u' },
  ]),
  initial: () => ({ level: 0 }),
  multiplier: ({ level }) => level + 1,
  next: (s, outcome) => {
    if (outcome === 'win') return { level: Math.min(s.level + 1, MAX_MULTIPLIER - 1) }
    if (outcome === 'loss') return { level: Math.max(s.level - 1, 0) }
    return s
  },
}

/**
 * Climb a unit per win, but hand the whole ladder back on a single loss. This
 * is the progression a Hopscotch-style campaign runs on: press while it is
 * working, start again from the opening stake the moment it is not.
 */
export const reverseDalembertReset: MoneyManagementSystem<{ level: number }> = {
  id: 'reverse-dalembert-reset',
  name: "Reverse D'Alembert (reset on loss)",
  description: 'Add one unit after a win; a loss drops all the way back to the opening stake.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: '+ 1u' },
    { label: 'After a loss', value: 'back to 1u' },
  ]),
  initial: () => ({ level: 0 }),
  multiplier: ({ level }) => level + 1,
  next: (s, outcome) => {
    if (outcome === 'win') return { level: Math.min(s.level + 1, MAX_MULTIPLIER - 1) }
    if (outcome === 'loss') return { level: 0 }
    return s
  },
}

const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]

export const fibonacci: MoneyManagementSystem<{ idx: number }> = {
  id: 'fibonacci',
  name: 'Fibonacci',
  description: 'Step forward in the Fibonacci sequence after a loss, back two after a win.',
  summary: summary('Betting ladder', [
    { label: 'Ladder', value: FIB.slice(0, 8).join(' → ') + ' …' },
    { label: 'After a win', value: 'back 2 places' },
    { label: 'After a loss', value: 'forward 1 place' },
  ]),
  initial: () => ({ idx: 0 }),
  multiplier: ({ idx }) => FIB[Math.min(idx, FIB.length - 1)],
  next: (s, outcome) => {
    if (outcome === 'loss') return { idx: Math.min(s.idx + 1, FIB.length - 1) }
    if (outcome === 'win') return { idx: Math.max(s.idx - 2, 0) }
    return s
  },
}

export const fibonacciReset: MoneyManagementSystem<{ idx: number }> = {
  id: 'fibonacci-reset',
  name: 'Fibonacci (reset on win)',
  description: 'Step forward in the Fibonacci sequence after a loss; a win drops back to the start.',
  summary: summary('Betting ladder', [
    { label: 'Ladder', value: FIB.slice(0, 8).join(' → ') + ' …' },
    { label: 'After a win', value: 'back to the start' },
    { label: 'After a loss', value: 'forward 1 place' },
  ]),
  initial: () => ({ idx: 0 }),
  multiplier: ({ idx }) => FIB[Math.min(idx, FIB.length - 1)],
  next: (s, outcome) => {
    if (outcome === 'loss') return { idx: Math.min(s.idx + 1, FIB.length - 1) }
    if (outcome === 'win') return { idx: 0 }
    return s
  },
}

export const labouchere: MoneyManagementSystem<{ line: number[] }> = {
  id: 'labouchere',
  name: 'Labouchere',
  description: 'Cancellation line 1-2-3-4: stake first+last, cross off on a win, append the stake on a loss.',
  summary: summary('Cancellation line', [
    { label: 'Starting line', value: '1 · 2 · 3 · 4' },
    { label: 'Stake', value: 'first + last of the line' },
    { label: 'On a win', value: 'cross both off' },
    { label: 'On a loss', value: 'append the stake' },
  ]),
  initial: () => ({ line: [1, 2, 3, 4] }),
  multiplier: ({ line }) => {
    if (line.length === 0) return 1
    if (line.length === 1) return line[0]
    return Math.min(line[0] + line[line.length - 1], MAX_MULTIPLIER)
  },
  next: (s, outcome) => {
    if (outcome === 'push') return s
    const line = s.line.length === 0 ? [1, 2, 3, 4] : [...s.line]
    const stake = line.length === 1 ? line[0] : line[0] + line[line.length - 1]
    if (outcome === 'win') {
      line.shift()
      line.pop()
      return { line: line.length === 0 ? [1, 2, 3, 4] : line }
    }
    if (line.length < 16) line.push(stake)
    return { line }
  },
}

/**
 * Labouchere run backwards: the line GROWS on wins and shrinks on losses, so
 * losses are small and capped while a hot streak compounds. The mirror image
 * of the original's risk shape.
 */
export const reverseLabouchere: MoneyManagementSystem<{ line: number[] }> = {
  id: 'reverse-labouchere',
  name: 'Reverse Labouchere',
  description: 'Cancellation line 1-2-3-4 run backwards: append the stake on a win, cross off on a loss.',
  summary: summary('Cancellation line', [
    { label: 'Starting line', value: '1 · 2 · 3 · 4' },
    { label: 'Stake', value: 'first + last of the line' },
    { label: 'On a win', value: 'append the stake' },
    { label: 'On a loss', value: 'cross both off' },
  ]),
  initial: () => ({ line: [1, 2, 3, 4] }),
  multiplier: ({ line }) => {
    if (line.length === 0) return 1
    if (line.length === 1) return line[0]
    return Math.min(line[0] + line[line.length - 1], MAX_MULTIPLIER)
  },
  next: (s, outcome) => {
    if (outcome === 'push') return s
    const line = s.line.length === 0 ? [1, 2, 3, 4] : [...s.line]
    const stake = line.length === 1 ? line[0] : line[0] + line[line.length - 1]
    if (outcome === 'win') {
      if (line.length < 16) line.push(stake)
      return { line }
    }
    // A loss crosses off both ends; emptying the line starts a fresh one.
    line.shift()
    line.pop()
    return { line: line.length === 0 ? [1, 2, 3, 4] : line }
  },
}

export const oscarsGrind: MoneyManagementSystem<{ mult: number; cycleNet: number }> = {
  id: 'oscars-grind',
  name: "Oscar's Grind",
  description: 'Raise one unit after a win, hold after a loss; reset once the cycle is +1 unit.',
  summary: summary('Progression', [
    { label: 'Opening stake', value: '1u' },
    { label: 'After a win', value: '+ 1u (never past the cycle target)' },
    { label: 'After a loss', value: 'unchanged' },
    { label: 'Cycle target', value: '+1u, then reset' },
  ]),
  initial: () => ({ mult: 1, cycleNet: 0 }),
  multiplier: ({ mult }) => mult,
  next: (s, outcome) => {
    if (outcome === 'push') return s
    const cycleNet = s.cycleNet + (outcome === 'win' ? s.mult : -s.mult)
    if (cycleNet >= 1) return { mult: 1, cycleNet: 0 }
    if (outcome === 'win') {
      // Never bet more than needed to finish the cycle +1.
      const target = Math.max(1, Math.min(s.mult + 1, 1 - cycleNet))
      return { mult: target, cycleNet }
    }
    return { mult: s.mult, cycleNet }
  },
}

const LADDER_1326 = [1, 3, 2, 6]

export const oneThreeTwoSix: MoneyManagementSystem<{ step: number }> = {
  id: '1-3-2-6',
  name: '1-3-2-6',
  description: 'Positive progression through 1-3-2-6 on wins; any loss (or finishing the ladder) resets.',
  summary: summary('Betting ladder', [
    { label: 'Ladder', value: LADDER_1326.join(' → ') },
    { label: 'After a win', value: 'forward 1 place' },
    { label: 'After a loss', value: 'back to the start' },
    { label: 'At the end', value: 'restart the ladder' },
  ]),
  initial: () => ({ step: 0 }),
  multiplier: ({ step }) => LADDER_1326[step],
  next: (s, outcome) => {
    if (outcome === 'win') return { step: s.step >= 3 ? 0 : s.step + 1 }
    if (outcome === 'loss') return { step: 0 }
    return s
  },
}

const LADDER_1324 = [1, 3, 2, 4]

export const oneThreeTwoFour: MoneyManagementSystem<{ step: number }> = {
  id: '1-3-2-4',
  name: '1-3-2-4',
  description: 'Positive progression through 1-3-2-4; any loss (or finishing the ladder) resets.',
  summary: summary('Betting ladder', [
    { label: 'Ladder', value: LADDER_1324.join(' → ') },
    { label: 'After a win', value: 'forward 1 place' },
    { label: 'After a loss', value: 'back to the start' },
    { label: 'Why 4', value: 'three wins lock in profit, unlike 1-3-2-6' },
  ]),
  initial: () => ({ step: 0 }),
  multiplier: ({ step }) => LADDER_1324[step],
  next: (s, outcome) => {
    if (outcome === 'win') return { step: s.step >= 3 ? 0 : s.step + 1 }
    if (outcome === 'loss') return { step: 0 }
    return s
  },
}

const LADDER_GOODMAN = [1, 2, 3, 5]

export const goodman: MoneyManagementSystem<{ step: number }> = {
  id: 'goodman',
  name: 'Goodman (1-2-3-5)',
  description: 'Positive progression through 1-2-3-5, holding at 5 while the streak runs; a loss resets.',
  summary: summary('Betting ladder', [
    { label: 'Ladder', value: LADDER_GOODMAN.join(' → ') },
    { label: 'After a win', value: 'forward 1 place, then hold at 5u' },
    { label: 'After a loss', value: 'back to the start' },
  ]),
  initial: () => ({ step: 0 }),
  multiplier: ({ step }) => LADDER_GOODMAN[Math.min(step, LADDER_GOODMAN.length - 1)],
  next: (s, outcome) => {
    // Unlike 1-3-2-6 this does not restart at the top: it rides 5u until a loss.
    if (outcome === 'win') return { step: Math.min(s.step + 1, LADDER_GOODMAN.length - 1) }
    if (outcome === 'loss') return { step: 0 }
    return s
  },
}

const LADDER_DALEMBERT_5 = [1, 2, 3, 4, 5]

/**
 * D'Alembert with a hard stop. Climbs a unit per loss like the original, resets
 * on a win — but gives up after five and starts again from the opening stake
 * rather than escalating without end. Total exposure across a full run is 15
 * units, which is what makes it survivable where an open-ended ladder is not.
 */
export const dalembertFiveStep: MoneyManagementSystem<{ step: number }> = {
  id: 'dalembert-5-step',
  name: "D'Alembert 5-Step (reset on win)",
  description:
    'Add one unit after a loss up to five steps, then start over; any win resets to the opening stake. Caps a losing run at 15 units.',
  summary: summary('Bounded ladder', [
    { label: 'Ladder', value: LADDER_DALEMBERT_5.join(' → ') },
    { label: 'Total exposure', value: '15u — the most a full run can lose' },
    { label: 'After a win', value: 'back to the start' },
    { label: 'After a loss', value: '+ 1u' },
    { label: 'At the end', value: 'restart the ladder' },
  ]),
  initial: () => ({ step: 0 }),
  multiplier: ({ step }) => LADDER_DALEMBERT_5[Math.min(step, LADDER_DALEMBERT_5.length - 1)],
  next: (s, outcome) => {
    if (outcome === 'loss') {
      return { step: s.step >= LADDER_DALEMBERT_5.length - 1 ? 0 : s.step + 1 }
    }
    if (outcome === 'win') return { step: 0 }
    return s
  },
}

const LADDER_31 = [1, 1, 1, 2, 2, 4, 4, 8, 8]

/**
 * Nine fixed steps totalling exactly 31 units, so the worst case is known
 * before you sit down — the only negative progression here with a hard ceiling
 * on what a losing run can cost.
 */
export const thirtyOneSystem: MoneyManagementSystem<{ step: number }> = {
  id: '31-system',
  name: '31 System (Six Pack)',
  description: 'Nine-step ladder 1-1-1-2-2-4-4-8-8 on losses; a win resets. Total exposure is capped at 31 units.',
  summary: summary('Bounded ladder', [
    { label: 'Ladder', value: LADDER_31.join(' → ') },
    { label: 'Total exposure', value: '31u — the most a full run can lose' },
    { label: 'After a win', value: 'back to the start' },
    { label: 'After a loss', value: 'forward 1 place' },
    { label: 'At the end', value: 'restart the ladder' },
  ]),
  initial: () => ({ step: 0 }),
  multiplier: ({ step }) => LADDER_31[Math.min(step, LADDER_31.length - 1)],
  next: (s, outcome) => {
    // Running off the end restarts rather than escalating for ever, which is
    // the whole point of a bounded system.
    if (outcome === 'loss') return { step: s.step >= LADDER_31.length - 1 ? 0 : s.step + 1 }
    if (outcome === 'win') return { step: 0 }
    return s
  },
}

/**
 * The one family here that is not a fixed ladder: each unit of the placement is
 * staked as a share of the CURRENT bankroll, so it scales down automatically
 * after losses and up after wins. It cannot be wiped out by a losing run the
 * way a doubling ladder can — the stake shrinks with the bankroll — but it also
 * never recovers a loss in one step.
 *
 * Note the stake is per unit of the bet, exactly as every other plan here: a
 * placement covering five numbers stakes five times this share.
 */
function proportionalPlan(pct: number): MoneyManagementSystem<null> {
  const label = `${(pct * 100).toFixed(pct < 0.01 ? 1 : 0)}%`
  return {
    id: `proportional-${Math.round(pct * 1000)}`,
    name: `Percentage of Bankroll (${label})`,
    description: `Stakes ${label} of the current bankroll per unit of the bet, so the stake scales with the money you actually have. Falls back to a flat unit if the bankroll is unknown.`,
    summary: summary('Proportional', [
      { label: 'Stake', value: `${label} of the current bankroll, per unit` },
      { label: 'After a win', value: 'stake rises with the bankroll' },
      { label: 'After a loss', value: 'stake shrinks with the bankroll' },
      { label: 'Floor', value: '0.1u — never rounds away to nothing' },
    ]),
    initial: () => null,
    multiplier: (_s, context) => {
      // Without a bankroll to read (older call sites, previews) behave as flat.
      if (!context) return 1
      const stake = context.bankrollUnits * pct
      if (!Number.isFinite(stake) || stake <= 0) return 0
      return Math.min(Math.max(stake, 0.1), MAX_MULTIPLIER)
    },
    next: s => s,
  }
}

export const proportional1 = proportionalPlan(0.01)
export const proportional = proportionalPlan(0.02)
export const proportional5 = proportionalPlan(0.05)

export const ALL_MONEY_SYSTEMS: MoneyManagementSystem<any>[] = [
  flat,
  martingale,
  grandMartingale,
  threeThenTwoRecovery,
  paroli,
  dalembert,
  dalembertReset,
  reverseDalembert,
  reverseDalembertReset,
  fibonacci,
  fibonacciReset,
  labouchere,
  reverseLabouchere,
  oscarsGrind,
  oneThreeTwoSix,
  oneThreeTwoFour,
  goodman,
  dalembertFiveStep,
  thirtyOneSystem,
  proportional1,
  proportional,
  proportional5,
]
