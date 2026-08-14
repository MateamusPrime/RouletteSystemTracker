import {
  ALL_BLACK,
  ALL_RED,
  NUMBERS_BY_COLUMN,
  NUMBERS_BY_DOZEN,
  colorOf,
  columnOf,
  dozenOf,
} from '../roulette'
import type { Bet, Spin } from '../types'
import type { PlacementContext, PlacementSystem } from './types'

/**
 * Hopscotch — hop between an even-money bet and a two-group bet, ratcheting the
 * stake up one unit every time a full there-and-back succeeds.
 *
 *   Step 1: one even-money box at `base` units.
 *     win  -> step 2, stake unchanged
 *     loss -> step 1 at the opening stake
 *   Step 2: two groups (dozens, columns, or one of each) at `base` units EACH,
 *           which is exactly step 1's stake plus what it just won.
 *     win  -> step 1 with base + 1
 *     loss -> step 1 at the opening stake
 *
 * The system stakes itself, so it is marked `selfManaged` and reports cycles:
 * a cycle ends whenever a loss knocks it back to the opening bet.
 */

/** How the two legs get picked each time the machine needs them. */
export type HopscotchMode = 'hot' | 'cold' | 'follow' | 'anchor' | 'rotate'
/** Which family of 2:1 boxes the second step plays. */
export type HopscotchGroups = 'dozens' | 'columns' | 'mixed'

/** Spins the hot and cold modes look back over. */
const WINDOW = 18

const MODE_LABEL: Record<HopscotchMode, string> = {
  hot: 'Hot',
  cold: 'Cold',
  follow: 'Follow the Last',
  anchor: 'Middle Anchor',
  rotate: 'Rotate',
}

const MODE_BLURB: Record<HopscotchMode, string> = {
  hot: `backs whatever has run hottest over the last ${WINDOW} spins`,
  cold: `backs whatever has run coldest over the last ${WINDOW} spins, playing for the catch-up`,
  follow: 'backs whatever just hit',
  anchor: 'always keeps the middle box and alternates the two outer ones',
  rotate: 'walks the pairs round in order — 1-2, 2-3, 3-1 — a fresh pair every trip',
}

const GROUP_LABEL: Record<HopscotchGroups, string> = {
  dozens: 'Dozens',
  columns: 'Columns',
  mixed: 'Dozen + Column',
}

// ---------------------------------------------------------------------------
// Counting helpers. These read a window ENDING at `end` without slicing, so a
// full replay of the history stays linear rather than quadratic.
// ---------------------------------------------------------------------------

function countGroups(
  spins: Spin[],
  end: number,
  groupOf: (n: number) => number,
): number[] {
  const counts = [0, 0, 0, 0] // index 0 = zeros
  for (let i = Math.max(0, end - WINDOW); i < end; i++) counts[groupOf(spins[i].n)]++
  return counts
}

/** The `want` groups (1-3) with the most or fewest hits, best first. */
function rankGroups(counts: number[], pick: 'hot' | 'cold', want: number): number[] {
  const ranked = [1, 2, 3].sort((a, b) =>
    pick === 'hot' ? counts[b] - counts[a] : counts[a] - counts[b],
  )
  return ranked.slice(0, want)
}

function evenMoneyLeg(
  spins: Spin[],
  end: number,
  mode: HopscotchMode,
  visits: number,
  units: number,
): Bet {
  const red = (u: number): Bet => ({ label: 'red', numbers: ALL_RED, payout: 1, units: u })
  const black = (u: number): Bet => ({ label: 'black', numbers: ALL_BLACK, payout: 1, units: u })

  if (mode === 'anchor') return red(units)
  if (mode === 'rotate') return visits % 2 === 0 ? red(units) : black(units)
  if (mode === 'follow') {
    const last = end > 0 ? colorOf(spins[end - 1].n) : 'red'
    return last === 'black' ? black(units) : red(units)
  }
  // Hot and cold compare the two colours over the window.
  let reds = 0
  let blacks = 0
  for (let i = Math.max(0, end - WINDOW); i < end; i++) {
    const c = colorOf(spins[i].n)
    if (c === 'red') reds++
    else if (c === 'black') blacks++
  }
  const redIsHotter = reds >= blacks
  const wantRed = mode === 'hot' ? redIsHotter : !redIsHotter
  return wantRed ? red(units) : black(units)
}

/** The pair of 2:1 boxes step 2 plays, as [dozen-or-column indexes]. */
function pickPair(
  spins: Spin[],
  end: number,
  mode: HopscotchMode,
  groupOf: (n: number) => number,
  visits: number,
): [number, number] {
  switch (mode) {
    case 'hot': {
      const [a, b] = rankGroups(countGroups(spins, end, groupOf), 'hot', 2)
      return [a, b]
    }
    case 'cold': {
      const [a, b] = rankGroups(countGroups(spins, end, groupOf), 'cold', 2)
      return [a, b]
    }
    case 'follow': {
      const last = end > 0 ? groupOf(spins[end - 1].n) : 0
      // A zero belongs to no group, so open on the first pair.
      if (last === 0) return [1, 2]
      return [last, (last % 3) + 1]
    }
    case 'anchor':
      // The middle box always, alternating which outer box joins it.
      return [2, visits % 2 === 0 ? 1 : 3]
    case 'rotate': {
      const pairs: [number, number][] = [
        [1, 2],
        [2, 3],
        [3, 1],
      ]
      return pairs[visits % 3]
    }
  }
}

function groupBet(kind: 'dozen' | 'column', index: number, units: number): Bet {
  return kind === 'dozen'
    ? { label: `dozen ${index}`, numbers: NUMBERS_BY_DOZEN[index], payout: 2, units }
    : { label: `column ${index}`, numbers: NUMBERS_BY_COLUMN[index], payout: 2, units }
}

/** Step 2's bets: two 2:1 boxes at `units` each. */
function twoGroupLeg(
  spins: Spin[],
  end: number,
  mode: HopscotchMode,
  groups: HopscotchGroups,
  visits: number,
  units: number,
): Bet[] {
  if (groups === 'mixed') {
    // One dozen and one column. They overlap, so a number in both pays twice —
    // which is the whole appeal of this variant.
    const [d] = pickPair(spins, end, mode, dozenOf, visits)
    const [c] = pickPair(spins, end, mode, columnOf, visits)
    return [groupBet('dozen', d, units), groupBet('column', c, units)]
  }
  const groupOf = groups === 'dozens' ? dozenOf : columnOf
  const [a, b] = pickPair(spins, end, mode, groupOf, visits)
  const kind = groups === 'dozens' ? 'dozen' : 'column'
  // Anchor and rotate can name the same box twice; collapse rather than
  // silently double the stake on it.
  if (a === b) return [groupBet(kind, a, units)]
  return [groupBet(kind, a, units), groupBet(kind, b, units)]
}

/**
 * The machine tracks only WHERE the chips go. It stakes a flat unit and leaves
 * every progression to the money system, so the same fifteen layouts can be run
 * against all twenty of them — including the ratchet Hopscotch is known for
 * (Reverse D'Alembert with reset on loss) and the softer step-down variant
 * (plain Reverse D'Alembert).
 */
interface HopState {
  step: 1 | 2
  /** Times step 1 has been entered, for the rotating even-money pick. */
  visits1: number
  /** Times step 2 has been entered, for the rotating group pick. */
  visits2: number
  /** Round trips the machine has resolved, either way. */
  cycles: number
}

const OPENING: HopState = { step: 1, visits1: 0, visits2: 0, cycles: 0 }

function betsForState(
  s: HopState,
  spins: Spin[],
  end: number,
  mode: HopscotchMode,
  groups: HopscotchGroups,
): Bet[] {
  return s.step === 1
    ? [evenMoneyLeg(spins, end, mode, s.visits1, 1)]
    : twoGroupLeg(spins, end, mode, groups, s.visits2, 1)
}

/**
 * Advances the machine over one resolved spin.
 *
 * The visit counters tick over as the machine LEAVES a step, not as it arrives,
 * so the first visit picks index 0. Counting on arrival skips the opening pair.
 *
 * A cycle closes whenever the machine returns to step 1 — on a completed round
 * trip as well as on a loss. Counting only the losses would hide every winning
 * trip from the overlay, leaving it unable to ratchet up on success.
 */
function advance(s: HopState, bets: Bet[], hit: number): HopState {
  const won = bets.some(b => b.numbers.includes(hit))
  const leavingStep2 = s.step === 2
  if (!won) {
    return {
      step: 1,
      visits1: s.visits1 + 1,
      visits2: s.visits2 + (leavingStep2 ? 1 : 0),
      cycles: s.cycles + 1,
    }
  }
  if (s.step === 1) {
    // Hop across to the two-group bet. Mid-trip, so the cycle stays open.
    return { ...s, step: 2, visits1: s.visits1 }
  }
  // A completed round trip: back to the even-money bet, cycle closed.
  return {
    step: 1,
    visits1: s.visits1 + 1,
    visits2: s.visits2 + 1,
    cycles: s.cycles + 1,
  }
}

/**
 * Replays the machine over the history.
 *
 * The simulation grows one array as it goes, so progress is cached against that
 * array and only the new spins are walked — replaying the whole session on
 * every spin would make a long one quadratic.
 *
 * The cache is a WeakMap rather than a single slot because one system object is
 * shared across every money system on the board: a single slot would thrash
 * between their separate histories and never hit.
 */
function makeReplay(mode: HopscotchMode, groups: HopscotchGroups) {
  const cache = new WeakMap<Spin[], { len: number; state: HopState }>()

  return (spins: Spin[]): HopState => {
    const hit = cache.get(spins)
    // A shorter array than last time means a different session reusing the
    // reference, so start over rather than trusting stale progress.
    let state = hit && spins.length >= hit.len ? hit.state : OPENING
    let from = hit && spins.length >= hit.len ? hit.len : 0
    for (let i = from; i < spins.length; i++) {
      state = advance(state, betsForState(state, spins, i, mode, groups), spins[i].n)
    }
    cache.set(spins, { len: spins.length, state })
    return state
  }
}

function hopscotchSystem(mode: HopscotchMode, groups: HopscotchGroups): PlacementSystem {
  // One replay serves both hooks: the cycle count falls out of the same state,
  // so computing it separately would double the work on every spin.
  const replay = makeReplay(mode, groups)
  const groupWord =
    groups === 'mixed' ? 'a dozen and a column' : groups === 'dozens' ? 'two dozens' : 'two columns'
  return {
    id: `hopscotch-${groups}-${mode}`,
    name: `Hopscotch ${GROUP_LABEL[groups]} — ${MODE_LABEL[mode]}`,
    description: `Hops between one even-money box and ${groupWord}: a win on the even-money bet hops across to the pair, a win there hops back. Flat one unit — pair it with Reverse D'Alembert (reset on loss) for the classic ratchet, or any other plan for a different one. Picking ${MODE_BLURB[mode]}.`,
    selfManaged: true,
    bets: ({ spins }: PlacementContext) => {
      const s = replay(spins)
      return betsForState(s, spins, spins.length, mode, groups)
    },
    // A cycle is one resolved round trip, so an overlay reacts to the hop as a
    // whole rather than to the intermediate step it is meant to absorb.
    cycleCount: ({ spins }: PlacementContext) => replay(spins).cycles,
  }
}

const MODES: HopscotchMode[] = ['hot', 'cold', 'follow', 'anchor', 'rotate']
const GROUPS: HopscotchGroups[] = ['dozens', 'columns', 'mixed']

export const ALL_HOPSCOTCH_SYSTEMS: PlacementSystem[] = GROUPS.flatMap(g =>
  MODES.map(m => hopscotchSystem(m, g)),
)

/** Exposed for tests: the machine's transition rules on their own. */
export const hopscotchInternals = {
  OPENING,
  betsForState,
  advance,
  makeReplay,
}
export type { HopState }
