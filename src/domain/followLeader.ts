import { clampToTableLimits, simulateCombo } from './simulation'
import type { ComboResult, PlacedBet } from './simulation'
import type { MoneyManagementSystem } from './money/types'
import type { PlacementSystem } from './placement/types'
import type { SessionConfig, Spin } from './types'

/** Spins the leaderboard needs before its top combo means anything at all. */
export const DEFAULT_WARMUP = 5

/**
 * Which combo counts as "the leader" at each spin.
 * - `profit` — most money made since spin 1, i.e. the leaderboard's top row.
 * - `trend` — biggest bankroll gain over the last `trendWindow` spins, i.e.
 *   whatever is hottest right now regardless of how it started.
 */
export type LeaderBy = 'profit' | 'trend'

export interface FollowStep {
  /** 0-based spin index. */
  index: number
  /** The pocket that hit. */
  n: number
  /** Combo whose bets were placed, or null while warming up / sitting out. */
  followedKey: string | null
  followedName: string | null
  /** True when this spin followed a different combo than the previous one. */
  switched: boolean
  bets: PlacedBet[]
  staked: number
  net: number
  bankroll: number
  note: string | null
}

export interface FollowResult {
  steps: FollowStep[]
  /** Bankroll after each spin, starting with the initial bankroll. */
  bankrollSeries: number[]
  profit: number
  totalStaked: number
  wins: number
  losses: number
  sitOuts: number
  maxDrawdown: number
  /**
   * Spins where the leader asked for more than was left. The bet is skipped and
   * play continues — being unable to cover one $185 progression step is not the
   * same as being broke, and the next ask is often only a few dollars.
   */
  skippedBets: number
  /** The largest single ask that had to be skipped, for display. */
  biggestSkip: number
  /** How many times the leaderboard's top combo changed under you. */
  switches: number
  /** How many different combos you ended up playing. */
  distinctFollowed: number
  warmup: number
  ruinedAt: number | null

  // --- controls, so the number above can be judged against something ---
  /** The combo leading when the warm-up ended. */
  lockInName: string | null
  /** What committing to that combo for the rest of the session would have made. */
  lockInProfit: number
  /** The best combo in hindsight — an upper bound nobody could have picked. */
  bestHindsightName: string
  bestHindsightProfit: number
  /** What an average combo made, as a neutral baseline. */
  averageProfit: number
}

function keyOf(r: { placementId: string; moneyId: string }): string {
  return `${r.placementId}::${r.moneyId}`
}

function nameOf(r: ComboResult): string {
  return `${r.placementName} × ${r.moneyName}`
}

/**
 * "If you had listened to the leaderboard at every spin, where would you be?"
 *
 * At each spin the top combo is decided from the spins BEFORE it — never with
 * hindsight — and that combo's chips are the ones placed. When the lead changes
 * you change with it, carrying your own bankroll across the switch. The result
 * is a real strategy you could have played, reported next to the controls that
 * make it judgeable: committing to the early leader, the best combo nobody
 * could have known to pick, and the average of the field.
 */
export function followTheLeader(
  results: ComboResult[],
  placements: PlacementSystem[],
  moneys: MoneyManagementSystem<any>[],
  spins: Spin[],
  config: SessionConfig,
  options: {
    warmup?: number
    freshProgressions?: boolean
    leaderBy?: LeaderBy
    trendWindow?: number
    /**
     * Internal. The lock-in control re-enters this function pinned to a single
     * combo so it faces the identical bankroll and affordability rules; without
     * this it would recurse forever computing its own controls.
     */
    skipControls?: boolean
  } = {},
): FollowResult {
  const warmup = Math.max(0, options.warmup ?? DEFAULT_WARMUP)
  const leaderBy: LeaderBy = options.leaderBy ?? 'profit'
  const trendWindow = Math.max(1, options.trendWindow ?? 15)
  /**
   * When set, you place the leader's PATTERN but run the progression yourself,
   * opening at the base stake and restarting whenever the lead changes. The
   * default instead copies the board's exact stakes, which means walking up
   * mid-progression and inheriting a step you never played into.
   */
  const fresh = options.freshProgressions === true
  const empty: FollowResult = {
    steps: [],
    bankrollSeries: [config.startingBankroll],
    profit: 0,
    totalStaked: 0,
    wins: 0,
    losses: 0,
    sitOuts: 0,
    maxDrawdown: 0,
    skippedBets: 0,
    biggestSkip: 0,
    switches: 0,
    distinctFollowed: 0,
    warmup,
    ruinedAt: null,
    lockInName: null,
    lockInProfit: 0,
    bestHindsightName: '',
    bestHindsightProfit: 0,
    averageProfit: 0,
  }
  if (results.length === 0 || spins.length === 0) return empty

  // Pass 1 — who was on top going into each spin? bankrollSeries[i] is the
  // bankroll BEFORE spin i, so it holds exactly what the board would have shown.
  // Trend scores the same series over a trailing window instead of from spin 1,
  // clamping at the start of the session the way the leaderboard column does.
  const score = (r: ComboResult, i: number): number =>
    leaderBy === 'trend'
      ? r.bankrollSeries[i] - r.bankrollSeries[Math.max(0, i - trendWindow)]
      : r.bankrollSeries[i]

  const leaderAt: (ComboResult | null)[] = []
  let incumbent: ComboResult | null = null
  for (let i = 0; i < spins.length; i++) {
    if (i < warmup) {
      leaderAt.push(null)
      continue
    }
    let best: ComboResult | null = incumbent
    let bestValue = incumbent ? score(incumbent, i) : -Infinity
    for (const r of results) {
      // Strictly-greater keeps you with the incumbent on a tie, so the model
      // does not churn between combos that are level.
      const v = score(r, i)
      if (v > bestValue + 1e-9) {
        best = r
        bestValue = v
      }
    }
    incumbent = best
    leaderAt.push(best)
  }

  // Pass 2 — only the combos that actually led need a trace, which is usually a
  // handful rather than the whole field.
  const needed = new Set(leaderAt.filter(Boolean).map(r => keyOf(r!)))
  const traced = new Map<
    string,
    { result: ComboResult; placement: PlacementSystem; money: MoneyManagementSystem<any> }
  >()
  for (const key of needed) {
    const [placementId, moneyId] = key.split('::')
    const p = placements.find(x => x.id === placementId)
    const m = moneys.find(x => x.id === moneyId)
    if (p && m) {
      traced.set(key, {
        result: simulateCombo(p, m, spins, config, { trace: true }),
        placement: p,
        money: m,
      })
    }
  }

  let bankroll = config.startingBankroll
  let peak = bankroll
  let maxDrawdown = 0
  let totalStaked = 0
  let wins = 0
  let losses = 0
  let sitOuts = 0
  let skippedBets = 0
  let biggestSkip = 0
  let switches = 0
  let ruinedAt: number | null = null
  let finished = false
  let previousKey: string | null = null
  const followedKeys = new Set<string>()
  const steps: FollowStep[] = []
  const bankrollSeries = [bankroll]
  /** The follower's own progression state, per leg, in fresh mode. */
  let legStates = new Map<string, any>()
  /** Spins already seen, so a placement can be re-asked what it wants to bet. */
  const history: Spin[] = []

  for (let i = 0; i < spins.length; i++) {
    const leader = leaderAt[i]
    const push = (over: Partial<FollowStep>) => {
      // Every path lands here exactly once, so history advances in step with
      // the loop without each `continue` having to remember to do it.
      history.push(spins[i])
      steps.push({
        index: i,
        n: spins[i].n,
        followedKey: null,
        followedName: null,
        switched: false,
        bets: [],
        staked: 0,
        net: 0,
        bankroll,
        note: null,
        ...over,
      })
      bankrollSeries.push(bankroll)
    }

    if (finished) {
      sitOuts++
      push({ note: `bankroll gone on spin ${ruinedAt} — no longer playing` })
      continue
    }
    if (leader === null) {
      sitOuts++
      push({ note: `warming up — the board needs ${warmup} spins before it means anything` })
      continue
    }

    const key = keyOf(leader)
    const source = traced.get(key)
    const switched = previousKey !== null && previousKey !== key
    if (switched) switches++
    const firstBet = previousKey === null
    previousKey = key
    followedKeys.add(key)

    // Which leg each bet belongs to, so a multi-leg system's progressions
    // advance independently. Only populated in fresh mode.
    let legOf: string[] = []
    let bets: PlacedBet[]

    if (fresh && source) {
      // Stepping onto a new combo means opening at its first stake, not the
      // step the board happens to be on.
      if (switched || firstBet) legStates = new Map()
      const { placement, money } = source
      const stateOf = (leg: string) => {
        if (!legStates.has(leg)) legStates.set(leg, money.initial())
        return legStates.get(leg)
      }
      const priced = placement
        .bets({ spins: history, config })
        .map(bet => {
          const leg = bet.leg ?? ''
          // Proportional plans size off the follower's own bankroll, which is
          // the whole point of replaying the progression rather than copying it.
          return {
            bet,
            leg,
            mult: money.multiplier(stateOf(leg), {
              bankrollUnits: bankroll / config.baseUnit,
              startingUnits: config.startingBankroll / config.baseUnit,
            }),
          }
        })
        .filter(p => p.mult > 0)
      const requested = priced.map(p => p.bet.units * p.mult * config.baseUnit)
      const amounts = config.clampToLimits
        ? clampToTableLimits(
            priced.map((p, ix) => ({ payout: p.bet.payout, amount: requested[ix] })),
            config,
          ).amounts
        : requested
      legOf = priced.map(p => p.leg)
      bets = priced.map((p, ix) => {
        const amount = amounts[ix]
        const capped = Math.abs(amount - requested[ix]) > 1e-9
        return {
          label: p.bet.label,
          numbers: p.bet.numbers,
          payout: p.bet.payout,
          amount,
          ...(capped ? { requested: requested[ix] } : {}),
          won: p.bet.numbers.includes(spins[i].n),
        }
      })
    } else {
      // The leader's traced bets are exactly what the board would have told you
      // to place, already capped to the table where that applies.
      bets = source?.result.trace?.[i]?.bets ?? []
    }

    if (bets.length === 0) {
      sitOuts++
      push({
        followedKey: key,
        followedName: nameOf(leader),
        switched,
        note: 'the leader sat this one out',
      })
      continue
    }

    const staked = bets.reduce((s, b) => s + b.amount, 0)
    // Not being able to cover one progression step is not ruin: you skip that
    // bet and carry on, because the next thing the board asks for may be $5.
    // Only an empty bankroll actually ends the session.
    if (staked > bankroll + 1e-9) {
      skippedBets++
      biggestSkip = Math.max(biggestSkip, staked)
      sitOuts++
      push({
        followedKey: key,
        followedName: nameOf(leader),
        switched,
        note: `wanted $${staked.toFixed(2)} but only $${bankroll.toFixed(2)} left — skipped, still playing`,
      })
      continue
    }

    // `won` is already resolved against this spin, so the payout is just a sum.
    const net = bets.reduce((s, b) => s + (b.won ? b.amount * b.payout : -b.amount), 0)

    // In fresh mode the progression reacts to what YOU just won or lost, per
    // leg, rather than to the leader's parallel session.
    if (fresh && source) {
      const money = source.money
      const legNet = new Map<string, number>()
      bets.forEach((b, ix) => {
        const leg = legOf[ix] ?? ''
        legNet.set(leg, (legNet.get(leg) ?? 0) + (b.won ? b.amount * b.payout : -b.amount))
      })
      for (const [leg, ln] of legNet) {
        legStates.set(
          leg,
          money.next(
            legStates.get(leg) ?? money.initial(),
            ln > 0 ? 'win' : ln < 0 ? 'loss' : 'push',
            ln / config.baseUnit,
          ),
        )
      }
    }

    totalStaked += staked
    bankroll += net
    if (net > 0) wins++
    else if (net < 0) losses++
    peak = Math.max(peak, bankroll)
    maxDrawdown = Math.max(maxDrawdown, peak - bankroll)
    if (bankroll <= 0) {
      finished = true
      ruinedAt = i + 1
    }
    push({
      followedKey: key,
      followedName: nameOf(leader),
      switched,
      bets,
      staked,
      net,
      bankroll,
    })
  }

  // Controls. Locking in means committing to whoever led when the warm-up
  // ended and riding them out. It is replayed through this same function with a
  // field of one, so it pays for the bets it cannot afford exactly as the
  // switching model does — reading that combo's own bankroll curve instead
  // would credit it with bets you could never have placed.
  const lockIn = leaderAt[warmup] ?? null
  const lockInProfit =
    lockIn && !options.skipControls
      ? followTheLeader([lockIn], placements, moneys, spins, config, {
          warmup,
          freshProgressions: fresh,
          leaderBy,
          trendWindow,
          skipControls: true,
        }).profit
      : 0
  let bestHindsight = results[0]
  for (const r of results) if (r.profit > bestHindsight.profit) bestHindsight = r
  const averageProfit = results.reduce((s, r) => s + r.profit, 0) / results.length

  return {
    steps,
    bankrollSeries,
    profit: bankroll - config.startingBankroll,
    totalStaked,
    wins,
    losses,
    sitOuts,
    maxDrawdown,
    skippedBets,
    biggestSkip,
    switches,
    distinctFollowed: followedKeys.size,
    warmup,
    ruinedAt,
    lockInName: lockIn ? nameOf(lockIn) : null,
    lockInProfit,
    bestHindsightName: nameOf(bestHindsight),
    bestHindsightProfit: bestHindsight.profit,
    averageProfit,
  }
}
