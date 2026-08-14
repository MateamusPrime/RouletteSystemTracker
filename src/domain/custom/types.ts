/**
 * Declarative definitions for user-built systems. These are plain JSON
 * (persistable to localStorage today, a database later) and are compiled into
 * live PlacementSystem / MoneyManagementSystem objects by the interpreters,
 * so custom systems behave exactly like built-ins everywhere in the app.
 */

// ---------------------------------------------------------------------------
// Placement (where chips go)
// ---------------------------------------------------------------------------

/** Static bets available on the felt. */
export type FixedBetKind =
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high'
  | 'dozen1'
  | 'dozen2'
  | 'dozen3'
  | 'column1'
  | 'column2'
  | 'column3'

export type TargetDef =
  /** A fixed region of the felt. */
  | { kind: 'fixed'; bet: FixedBetKind }
  /** Straight-up bets on a hand-picked set of numbers (units are PER number). */
  | { kind: 'numbers'; numbers: number[] }
  /** The dozen/column that hit most in the last `window` spins. rank 2 = second hottest. */
  | { kind: 'hotGroup'; group: 'dozen' | 'column'; window: number; rank: 1 | 2 }
  /** The dozen/column that hit least in the last `window` spins. */
  | { kind: 'coldGroup'; group: 'dozen' | 'column'; window: number }
  /** Straight-up on the `count` most frequent numbers of the last `window` spins. */
  | { kind: 'hotNumbers'; count: number; window: number }
  /** Straight-up on the `count` numbers absent the longest. */
  | { kind: 'coldNumbers'; count: number; window: number }
  /** The color that just hit / its opposite. */
  | { kind: 'lastColor' }
  | { kind: 'oppositeLastColor' }
  /** The dozen / column that just hit. */
  | { kind: 'lastDozen' }
  | { kind: 'lastColumn' }
  /** Straight-up on the last number and `span` physical neighbours each side. */
  | { kind: 'neighbours'; span: number }
  /** Straight-up on the last number (chasing repeats). */
  | { kind: 'repeatLast' }

export type ConditionDef =
  /** Bet every spin. */
  | { kind: 'always' }
  /** Only bet when the last `length` spins all fell in the same group (streak trigger). */
  | { kind: 'streak'; group: 'color' | 'oddEven' | 'highLow' | 'dozen' | 'column'; length: number }
  /** Only bet when NONE of the target's numbers hit in the last `gap` spins (sleeper trigger). */
  | { kind: 'targetSleeping'; gap: number }
  /** Only bet when the target hit at least `minHits` times in the last `window` spins (hot trigger). */
  | { kind: 'targetHitting'; window: number; minHits: number }

export interface BetRule {
  target: TargetDef
  condition: ConditionDef
  /** Base units staked (per number for straight-up targets). */
  units: number
}

export interface PlacementDef {
  variant?: 'rules'
  id: string
  name: string
  description: string
  /** Sit out until this many spins are recorded. */
  minSpins: number
  rules: BetRule[]
}

// ---------------------------------------------------------------------------
// Step placement systems (board-layout state machines)
// ---------------------------------------------------------------------------

/** A chip placed on the board within a step. Static targets only. */
export interface StepBetDef {
  target:
    | { kind: 'fixed'; bet: FixedBetKind }
    /** Straight-up spread: stakes `units` PER number, each paying 35:1. */
    | { kind: 'numbers'; numbers: number[] }
    /**
     * One inside bet covering 2/3/4/6 numbers with a single chip:
     * split (17:1), street (11:1), corner (8:1), six line (5:1).
     * Payout = 36 / numbers.length − 1.
     */
    | { kind: 'combo'; numbers: number[] }
  /** Base units for fixed funding; relative WEIGHT for carry funding. */
  units: number
}

/** Where to go next: a step index, or 'restart' (= back to step 0). */
export type StepNext = number | 'restart'

export interface StepDef {
  name: string
  bets: StepBetDef[]
  /**
   * fixed: stake the listed units.
   * carry: stake the previous step's net win minus `pocketUnits` (pocketed),
   * spread across this step's bets proportionally to their units. If there is
   * nothing left after pocketing, the system restarts instead. `plannedWin` is
   * the incoming win the units were budgeted against (UI accounting only —
   * at runtime the actual win is distributed in the same proportions).
   */
  funding:
    | { type: 'fixed' }
    | {
        type: 'carry'
        pocketUnits: number
        plannedWin?: number
        /**
         * What "the winnings" means: 'gross' = stakes back + winnings (the
         * chips physically picked up), 'net' = profit only. Defaults to 'net'
         * for definitions saved before this option existed.
         */
        basis?: 'net' | 'gross'
      }
  /** next[k] = destination when exactly k of this step's bets won. Length = bets.length + 1. */
  next: StepNext[]
  /**
   * Optional per-outcome overrides: key = sorted winning-bet labels joined
   * with '|' (see outcomeKey). When the spin's exact winner set matches a key
   * it wins over the hit-count rule in `next`.
   */
  outcomeNext?: Record<string, StepNext>
}

export interface StepPlacementDef {
  variant: 'steps'
  id: string
  name: string
  description: string
  steps: StepDef[]
  /** Dollar value of one unit, display-only: previews $ amounts in the builder. */
  previewUnit?: number
}

// ---------------------------------------------------------------------------
// GB placement systems (independent legs, shared bankroll)
// ---------------------------------------------------------------------------

/** The outside bets a GB system can watch, each as its own leg. */
export type GbLegKind = FixedBetKind

/**
 * What a leg actually covers. Outside boxes are named; anything inside the
 * felt is a set of numbers whose payout follows from how many it covers
 * (1 = straight up 35:1, 2 = split, 3 = street, 4 = corner, 6 = six line).
 */
export type GbTarget =
  | { kind: 'fixed'; bet: GbLegKind }
  | { kind: 'combo'; numbers: number[] }

/** What has to happen before a leg starts betting. */
export type GbTrigger =
  /** Bet it every spin. */
  | { kind: 'always' }
  /** Bet once the leg has not hit for `spins` spins. */
  | { kind: 'asleep'; spins: number }
  /** Bet once the leg has hit `times` or more in the last `window` spins. */
  | { kind: 'hot'; window: number; times: number }

export interface GbLegDef {
  /** Outside box this leg plays. Kept for definitions saved before `target`. */
  bet?: GbLegKind
  /** What the leg covers; falls back to `bet` for older definitions. */
  target?: GbTarget
  units: number
  trigger: GbTrigger
}

/** Normalises a leg written in either shape. */
export function gbLegTarget(leg: GbLegDef): GbTarget {
  return leg.target ?? { kind: 'fixed', bet: leg.bet ?? 'red' }
}

export interface GbPlacementDef {
  variant: 'gb'
  id: string
  name: string
  description: string
  legs: GbLegDef[]
}

// ---------------------------------------------------------------------------
// Marti GB (anchor number drives the legs, played in rounds)
// ---------------------------------------------------------------------------

/** Which families of outside bet the anchor number pulls in. */
export type MartiFamily = 'color' | 'parity' | 'half' | 'dozen' | 'column'

export interface MartiPlacementDef {
  variant: 'marti'
  id: string
  name: string
  description: string
  /** The number on the board (1-36) whose properties define the legs. */
  anchor: number
  families: MartiFamily[]
  units: number
  /**
   * A leg that wins stands down until every leg has won; then the round
   * restarts. When true each leg's progression also restarts from the opening
   * stake, matching "wait to rebet the initial bet".
   */
  resetEachRound: boolean
  /** Also play the anchor number itself, straight up at 35:1. */
  includeStraight?: boolean
}

export type AnyPlacementDef =
  | PlacementDef
  | StepPlacementDef
  | GbPlacementDef
  | MartiPlacementDef

export function isStepPlacement(def: AnyPlacementDef): def is StepPlacementDef {
  return (def as StepPlacementDef).variant === 'steps'
}

export function isGbPlacement(def: AnyPlacementDef): def is GbPlacementDef {
  return (def as GbPlacementDef).variant === 'gb'
}

export function isMartiPlacement(def: AnyPlacementDef): def is MartiPlacementDef {
  return (def as MartiPlacementDef).variant === 'marti'
}

// ---------------------------------------------------------------------------
// Money management (how much to stake)
// ---------------------------------------------------------------------------

export type StepOp = 'reset' | 'hold' | 'add' | 'subtract' | 'multiply' | 'divide'

export interface StepAction {
  op: StepOp
  value: number
}

export type SeqOp = 'reset' | 'hold' | 'forward' | 'back'

export interface SeqAction {
  op: SeqOp
  steps: number
}

/**
 * Session-level guards that wrap any money style: walk away at a profit
 * target or loss limit (stake drops to 0 for the rest of the session), and
 * scale the stake while ahead or behind. All values in units; null/1 = off.
 */
export interface MoneyGuardsDef {
  /** Walk away once session profit ≥ this many units (null = never). */
  stopWinUnits: number | null
  /** Walk away once session loss ≥ this many units (null = never). */
  stopLossUnits: number | null
  /** Stake multiplier applied while the session is in profit (1 = unchanged). */
  aheadFactor: number
  /** Stake multiplier applied while the session is behind (1 = unchanged). */
  behindFactor: number
  /**
   * Recurring bank-and-reset target: once the CURRENT cycle's profit reaches
   * this many units, the staking plan resets to its starting state and a new
   * cycle begins (profit is measured from where each cycle started). This is
   * what powers "climb until +$50, bank it, start over" systems.
   */
  cycleTargetUnits?: number | null
  /**
   * How the next target is measured after banking a cycle:
   * - 'milestones' (default): fixed multiples of the target from session start
   *   (+50, +100, +150…) — overshoot counts toward the next milestone.
   * - 'from-cycle-start': each cycle needs a full target from wherever the
   *   previous one ended — overshoot is carried and does not count.
   */
  cycleBasis?: 'milestones' | 'from-cycle-start'
  /** Give up the current cycle and reset after it loses this many units. */
  cycleStopLossUnits?: number | null
  /** Walk away after this many completed cycles (0/null = keep going). */
  maxCycles?: number | null
}

export type MoneyDef =
  /** Multiplier progression: start at `start`, transform on win/loss. */
  | {
      id: string
      name: string
      description: string
      mode: 'progression'
      start: number
      onWin: StepAction
      onLoss: StepAction
      /** Reset to start after this many consecutive wins (0 = never). */
      winStreakReset: number
      /** Hard cap on the multiplier. */
      cap: number
      guards?: MoneyGuardsDef
      /** Dollar value of one unit, display-only. */
      previewUnit?: number
    }
  /** Fixed betting ladder: step through `sequence` on wins/losses. */
  | {
      id: string
      name: string
      description: string
      mode: 'sequence'
      sequence: number[]
      onWin: SeqAction
      onLoss: SeqAction
      /** What happens walking off the end of the sequence. */
      endBehavior: 'clamp' | 'reset'
      cap: number
      guards?: MoneyGuardsDef
      previewUnit?: number
    }
  /** Labouchere-style cancellation line. */
  | {
      id: string
      name: string
      description: string
      mode: 'cancellation'
      line: number[]
      cap: number
      guards?: MoneyGuardsDef
      previewUnit?: number
    }
  /** Step machine: each step has a stake and win/loss destinations. */
  | {
      id: string
      name: string
      description: string
      mode: 'steps'
      steps: MoneyStepDef[]
      cap: number
      guards?: MoneyGuardsDef
      previewUnit?: number
    }

export interface MoneyStepDef {
  mult: number
  /** Step index to jump to, or 'stay'. */
  onWin: number | 'stay'
  onLoss: number | 'stay'
}

export interface CustomSystems {
  placements: AnyPlacementDef[]
  moneys: MoneyDef[]
}
