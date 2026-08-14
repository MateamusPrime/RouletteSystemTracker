import type { MoneyManagementSystem } from './money'
import type { PlacementSystem } from './placement'
import { pocketsFor } from './roulette'
import type { SystemSummary } from './summary'
import type { SessionConfig, Spin, SpinOutcome } from './types'

/** A bet as it was actually placed on one spin, in currency. */
export interface PlacedBet {
  label: string
  numbers: number[]
  payout: number
  /** What was actually placed on the felt — capped to the table if enabled. */
  amount: number
  /** What the progression wanted, when the table forced a smaller bet. */
  requested?: number
  /**
   * Which independent progression priced this chip. Multi-leg systems (GB,
   * Marti, Sleeping Sector) run one plan per leg off a shared bankroll, so a
   * spin can be a win overall while an individual leg lost and correctly
   * staked up. Without this the review cannot show why a stake moved.
   */
  leg?: string
  won: boolean
}

/** Full record of one spin for the session review. */
export interface TraceEntry {
  index: number
  n: number
  bets: PlacedBet[]
  staked: number
  net: number
  bankroll: number
  outcome: SpinOutcome | 'sit-out'
  /** Table-limit problems for this spin, if any (flag mode). */
  violations: string[]
  /** Bets the table forced smaller this spin (cap mode). */
  caps?: string[]
  /** Bets the table forced UP to the minimum this spin (cap mode). */
  raises?: string[]
}

/**
 * Constrains each bet to the table limits, in currency. Outside bets are held
 * to [min, maxOutside], inside bets to at most maxInside, and the inside total
 * is raised to the minimum as a group (real tables apply the inside minimum to
 * the total, not each number). This is the alternative to merely flagging: a
 * player physically cannot bet over the ceiling, so a capped Martingale wins
 * back only the ceiling — never the full amount its progression demanded.
 */
export function clampToTableLimits(
  bets: { payout: number; amount: number }[],
  config: SessionConfig,
): { amounts: number[]; capped: boolean; raised: boolean } {
  const { tableMin } = config
  const amounts = bets.map(b => b.amount)
  // The two directions are tracked apart: a bet cut down to the ceiling and a
  // bet pushed up to the minimum are opposite problems and read as such.
  let capped = false
  let raised = false
  bets.forEach((b, i) => {
    let a = amounts[i]
    const ceiling = maxForPayout(b.payout, config)
    if (ceiling && a > ceiling) a = ceiling
    if (isOutsideBet(b.payout) && tableMin && a < tableMin) a = tableMin
    if (a < amounts[i] - 1e-9) capped = true
    else if (a > amounts[i] + 1e-9) raised = true
    amounts[i] = a
  })
  if (tableMin) {
    let insideTotal = 0
    bets.forEach((b, i) => {
      if (!isOutsideBet(b.payout)) insideTotal += amounts[i]
    })
    if (insideTotal > 1e-9 && insideTotal < tableMin) {
      const scale = tableMin / insideTotal
      bets.forEach((b, i) => {
        if (!isOutsideBet(b.payout)) amounts[i] *= scale
      })
      // Scaling the inside total up to the minimum is always an increase.
      raised = true
    }
  }
  return { amounts, capped, raised }
}

/** Outside bets pay 1:1 or 2:1; everything else is an inside bet. */
export function isOutsideBet(payout: number): boolean {
  return payout <= 2
}

/**
 * The ceiling for one bet, in currency. A per-payout tier set in the table
 * setup wins; otherwise the coarse outside/inside maximum applies. 0 means the
 * tier is uncapped, so a table can limit straight-ups without limiting dozens.
 */
export function maxForPayout(payout: number, config: SessionConfig): number {
  const tier = config.tableMaxByPayout?.[String(payout)]
  if (tier && tier > 0) return tier
  return (isOutsideBet(payout) ? config.tableMaxOutside : config.tableMaxInside) ?? 0
}

/** Table-rule problems for one spin's set of bets, in currency. */
function checkTableLimits(bets: PlacedBet[], config: SessionConfig): string[] {
  const problems: string[] = []
  const { tableMin } = config
  let insideTotal = 0
  for (const b of bets) {
    const outside = isOutsideBet(b.payout)
    if (outside && tableMin && b.amount < tableMin - 1e-9) {
      problems.push(`${b.label} $${b.amount.toFixed(2)} is below the $${tableMin} minimum`)
    }
    if (!outside) insideTotal += b.amount
    const ceiling = maxForPayout(b.payout, config)
    if (ceiling && b.amount > ceiling + 1e-9) {
      // Name the exact tier when the table sets one, so the flag points at the
      // rule the player actually configured rather than a generic bucket.
      const tier = config.tableMaxByPayout?.[String(b.payout)]
      const which = tier && tier > 0 ? `${b.payout}:1` : outside ? 'outside' : 'inside'
      problems.push(`${b.label} $${b.amount.toFixed(2)} is over the $${ceiling} ${which} maximum`)
    }
  }
  if (tableMin && insideTotal > 0 && insideTotal < tableMin - 1e-9) {
    problems.push(`inside bets total $${insideTotal.toFixed(2)} is below the $${tableMin} minimum`)
  }
  return problems
}

export interface ComboResult {
  placementId: string
  placementName: string
  /** Summary of how the placement system works, for hover cards. */
  placementDescription: string
  /** Structured breakdown, when the system provides one. */
  placementSummary?: SystemSummary
  moneyId: string
  moneyName: string
  /** The money plan's own name, undecorated — what filters match on. */
  moneyBaseName: string
  /** Progression summary of the money system, for hover cards. */
  moneyDescription: string
  moneySummary?: SystemSummary
  /** Bankroll after each spin, starting with the initial bankroll. */
  bankrollSeries: number[]
  profit: number
  wins: number
  losses: number
  pushes: number
  /** Spins where the system placed no bet. */
  sitOuts: number
  totalStaked: number
  maxDrawdown: number
  /** Largest single-spin stake the combo asked for, in currency. */
  peakStake: number
  /** True if bankroll hit zero or below at any point. */
  busted: boolean
  currentStreak: number // + for consecutive wins, - for consecutive losses
  /**
   * What the combo wants to bet NEXT spin: the numbers each bet covers, its
   * payout, and the dollar amount — enough to draw the chips on the felt.
   */
  nextBets: { label: string; numbers: number[]; payout: number; amount: number }[]
  /**
   * Standard deviation of the session's total result, in currency, computed
   * from the bets that were actually placed. A straight-up system swings
   * roughly six times as hard as an even-money one for the same stake, so
   * this cannot be approximated from the stake alone.
   */
  swing: number
  /** True when the placement runs its own progression (step systems). */
  selfManaged: boolean
  /** Completed cycles of a self-managed system. */
  cyclesCompleted: number
  /** Spins whose bets broke a table minimum or maximum (flag mode). */
  limitBreaches: number
  /** The first such problem, for display. */
  firstBreach: string | null
  /** Spins where the table forced a bet smaller than the plan wanted (cap mode). */
  cappedSpins: number
  /** The first cap, for display. */
  firstCap: string | null
  /** Spins where a bet had to be pushed UP to the table minimum (cap mode). */
  raisedSpins: number
  /** The first raise, for display. */
  firstRaise: string | null
  /** Spins the combo had to skip because it could not cover the stake. */
  unaffordableSpins: number
  /** Spin number (1-based) where the bankroll first could not cover the bet. */
  ruinedAt: number | null
  /** Spin (1-based) where a win/loss guardrail ended the session, if any. */
  stoppedAt: number | null
  /** Why the guardrail fired, for display. */
  stopReason: string | null
  /** Per-spin detail; only populated when `trace` is requested. */
  trace?: TraceEntry[]
}

export interface SimulateOptions {
  /** Record per-spin detail for the session review (costlier — use on demand). */
  trace?: boolean
}

/**
 * Replays the full spin history for one placement × money-management combo.
 * Every combo sees the exact same spins the player actually recorded, so the
 * leaderboard answers: "which combo WOULD have made the most money so far?"
 */
export function simulateCombo(
  placement: PlacementSystem,
  money: MoneyManagementSystem<any>,
  spins: Spin[],
  config: SessionConfig,
  options: SimulateOptions = {},
): ComboResult {
  let bankroll = config.startingBankroll

  // A "GB" placement runs several independent legs at once: each keeps its own
  // money-management state while they all draw on one bankroll. Systems with a
  // single progression simply use the one default leg.
  const DEFAULT_LEG = ''
  const legStates = new Map<string, any>()
  const stateOf = (leg: string) => {
    if (!legStates.has(leg)) legStates.set(leg, money.initial())
    return legStates.get(leg)
  }
  let peak = bankroll
  let maxDrawdown = 0
  let peakStake = 0
  let wins = 0
  let losses = 0
  let pushes = 0
  let sitOuts = 0
  let totalStaked = 0
  let busted = false
  let streak = 0
  let limitBreaches = 0
  let firstBreach: string | null = null
  let cappedSpins = 0
  let firstCap: string | null = null
  let raisedSpins = 0
  let firstRaise: string | null = null
  const clamp = config.clampToLimits === true
  let unaffordableSpins = 0
  let ruinedAt: number | null = null
  let stoppedAt: number | null = null
  let stopReason: string | null = null
  /** Once the bankroll cannot cover a required bet, the session is over. */
  let finished = false
  const bankrollSeries = [bankroll]
  const trace: TraceEntry[] | undefined = options.trace ? [] : undefined

  // Systems with their own progression (step systems) resolve money management
  // once per completed cycle, so an overlay never reacts to the intermediate
  // losses the system is designed to absorb.
  const perCycle = typeof placement.cycleCount === 'function'
  let lastCycles = perCycle ? placement.cycleCount!({ spins: [], config }) : 0
  let cycleNet = 0
  const settleCycle = (history: Spin[], net: number) => {
    cycleNet += net
    const now = placement.cycleCount!({ spins: history, config })
    if (now > lastCycles) {
      const cycleOutcome: SpinOutcome =
        cycleNet > 0 ? 'win' : cycleNet < 0 ? 'loss' : 'push'
      legStates.set(
        DEFAULT_LEG,
        money.next(stateOf(DEFAULT_LEG), cycleOutcome, cycleNet / config.baseUnit),
      )
      cycleNet = 0
      lastCycles = now
    }
  }

  // One array that grows as the session replays. Slicing a fresh history for
  // every spin made the whole simulation quadratic; systems only ever read it.
  const history: Spin[] = []

  // Exact variance of each spin's result, summed. Spins are independent, so
  // the session's variance is the sum and its swing is the square root.
  const pockets = pocketsFor(config.wheelType)
  const payoffByPocket = new Float64Array(38)
  let varianceSum = 0
  /**
   * Variance of one spin given the bets on the table. Every bet loses its
   * stake and each winning pocket returns stake x (payout + 1), so the result
   * is a constant plus a per-pocket payoff — cheap to accumulate exactly.
   */
  const addSpinVariance = (bets: PlacedBet[], staked: number) => {
    payoffByPocket.fill(0)
    for (const b of bets) {
      const back = b.amount * (b.payout + 1)
      for (const n of b.numbers) payoffByPocket[n] += back
    }
    let mean = 0
    let meanSq = 0
    for (const p of pockets) {
      const net = payoffByPocket[p] - staked
      mean += net
      meanSq += net * net
    }
    mean /= pockets.length
    meanSq /= pockets.length
    varianceSum += Math.max(meanSq - mean * mean, 0)
  }

  for (let i = 0; i < spins.length; i++) {
    // A busted bankroll does not recover. Stop playing rather than waiting for
    // a cheaper bet to come along — that is the whole point of a bankroll.
    if (finished) {
      sitOuts++
      history.push(spins[i])
      bankrollSeries.push(bankroll)
      trace?.push({
        index: i,
        n: spins[i].n,
        bets: [],
        staked: 0,
        net: 0,
        bankroll,
        outcome: 'sit-out',
        violations: [
          stoppedAt !== null
            ? `stopped on spin ${stoppedAt} (${stopReason}) — no longer playing`
            : `out of money since spin ${ruinedAt} — no longer playing`,
        ],
      })
      continue
    }

    const bets = placement.bets({ spins: history, config })
    // Bankroll-proportional plans size off what is actually left; ladder plans
    // ignore this entirely.
    const moneyContext = {
      bankrollUnits: bankroll / config.baseUnit,
      startingUnits: config.startingBankroll / config.baseUnit,
    }
    // Each bet is priced by its own leg's progression. A leg whose plan has
    // walked away (multiplier 0) simply does not bet this spin.
    const priced = bets
      .map(bet => {
        const leg = bet.leg ?? DEFAULT_LEG
        return { bet, leg, mult: money.multiplier(stateOf(leg), moneyContext) }
      })
      .filter(p => p.mult > 0)
    if (priced.length === 0) {
      sitOuts++
      history.push(spins[i])
      if (perCycle) settleCycle(history, 0)
      bankrollSeries.push(bankroll)
      trace?.push({
        index: i,
        n: spins[i].n,
        bets: [],
        staked: 0,
        net: 0,
        bankroll,
        outcome: 'sit-out',
        violations: [],
      })
      continue
    }

    const hit = spins[i].n
    let net = 0
    let staked = 0
    const placed: PlacedBet[] = []
    /** Net result per leg, so each leg's plan reacts only to its own bets. */
    const legNet = new Map<string, number>()

    // The progression's demand for each bet, before the table has its say.
    const requested = priced.map(p => p.bet.units * p.mult * config.baseUnit)
    // In cap mode the placed amount is constrained; otherwise it is the demand.
    const clampResult = clamp
      ? clampToTableLimits(
          priced.map((p, i) => ({ payout: p.bet.payout, amount: requested[i] })),
          config,
        )
      : { amounts: requested, capped: false, raised: false }
    const amounts = clampResult.amounts
    const caps: string[] = []
    const raises: string[] = []

    priced.forEach(({ bet, leg }, idx) => {
      const amount = amounts[idx]
      const want = requested[idx]
      const won = bet.numbers.includes(hit)
      const betNet = won ? amount * bet.payout : -amount
      staked += amount
      net += betNet
      legNet.set(leg, (legNet.get(leg) ?? 0) + betNet)
      const adjusted = Math.abs(amount - want) > 1e-9
      if (adjusted) {
        const note = `${bet.label} $${want.toFixed(2)} → $${amount.toFixed(2)}`
        if (amount < want) caps.push(note)
        else raises.push(note)
      }
      placed.push({
        label: bet.label,
        numbers: bet.numbers,
        payout: bet.payout,
        amount,
        ...(adjusted ? { requested: want } : {}),
        ...(leg !== DEFAULT_LEG ? { leg } : {}),
        won,
      })
    })

    // Two ways to treat a bet the table would not allow. In flag mode the full
    // amount is played and recorded as a violation; in cap mode it was already
    // constrained above, so record what had to give instead.
    let violations: string[] = []
    if (clamp) {
      if (clampResult.capped) {
        cappedSpins++
        if (firstCap === null) firstCap = `spin ${i + 1}: ${caps[0]}`
      }
      if (clampResult.raised) {
        raisedSpins++
        if (firstRaise === null) firstRaise = `spin ${i + 1}: ${raises[0]}`
      }
    } else {
      violations = checkTableLimits(placed, config)
      if (violations.length > 0) {
        limitBreaches++
        if (firstBreach === null) firstBreach = `spin ${i + 1}: ${violations[0]}`
      }
    }

    // You cannot place chips you do not have. A combo whose progression
    // outgrows the bankroll is ruined: it sits out from here rather than
    // silently betting money that was never there.
    if (staked > bankroll + 1e-9) {
      unaffordableSpins++
      if (ruinedAt === null) ruinedAt = i + 1
      finished = true
      sitOuts++
      history.push(spins[i])
      if (perCycle) settleCycle(history, 0)
      bankrollSeries.push(bankroll)
      trace?.push({
        index: i,
        n: hit,
        bets: [],
        staked: 0,
        net: 0,
        bankroll,
        outcome: 'sit-out',
        violations: [
          ...violations,
          `needs $${staked.toFixed(2)} but only $${bankroll.toFixed(2)} left — bet not placed`,
        ],
      })
      continue
    }

    addSpinVariance(placed, staked)
    totalStaked += staked
    peakStake = Math.max(peakStake, staked)
    bankroll += net
    const outcome: SpinOutcome = net > 0 ? 'win' : net < 0 ? 'loss' : 'push'
    if (outcome === 'win') {
      wins++
      streak = streak > 0 ? streak + 1 : 1
    } else if (outcome === 'loss') {
      losses++
      streak = streak < 0 ? streak - 1 : -1
    } else {
      pushes++
    }
    history.push(spins[i])
    if (perCycle) {
      settleCycle(history, net)
    } else {
      // Advance only the legs that actually had money on the table.
      for (const [leg, legResult] of legNet) {
        const legOutcome: SpinOutcome =
          legResult > 0 ? 'win' : legResult < 0 ? 'loss' : 'push'
        legStates.set(
          leg,
          money.next(stateOf(leg), legOutcome, legResult / config.baseUnit),
        )
      }
    }

    peak = Math.max(peak, bankroll)
    maxDrawdown = Math.max(maxDrawdown, peak - bankroll)
    if (bankroll <= 0) {
      busted = true
      finished = true
      if (ruinedAt === null) ruinedAt = i + 1
    }
    // A disciplined player walks when they hit their number, so a combo that
    // reaches a guardrail books the result and stops rather than giving it back.
    if (!finished) {
      const swing = bankroll - config.startingBankroll
      const { stopWin, stopLoss } = config
      if (stopWin && swing >= stopWin - 1e-9) {
        stopReason = `up $${swing.toFixed(0)} — hit the $${stopWin} win goal`
      } else if (stopLoss && -swing >= stopLoss - 1e-9) {
        stopReason = `down $${(-swing).toFixed(0)} — hit the $${stopLoss} loss limit`
      }
      if (stopReason !== null) {
        finished = true
        stoppedAt = i + 1
      }
    }
    bankrollSeries.push(bankroll)
    trace?.push({
      index: i,
      n: hit,
      bets: placed,
      staked,
      net,
      bankroll,
      outcome,
      violations,
      ...(caps.length > 0 ? { caps } : {}),
      ...(raises.length > 0 ? { raises } : {}),
    })
  }

  // The next bet is sized off the bankroll the session actually ended on.
  const finalContext = {
    bankrollUnits: bankroll / config.baseUnit,
    startingUnits: config.startingBankroll / config.baseUnit,
  }
  const nextRaw = finished
    ? [] // out of money: there is no next bet
    : placement
        .bets({ spins, config })
        .map(b => ({
          label: b.label,
          numbers: b.numbers,
          payout: b.payout,
          amount:
            b.units *
            money.multiplier(stateOf(b.leg ?? DEFAULT_LEG), finalContext) *
            config.baseUnit,
        }))
        .filter(b => b.amount > 0) // multiplier 0 = walked away / sitting out
  // In cap mode the recommendation shows what the table would actually let you
  // put down, not the plan's raw demand.
  const nextAmounts = clamp
    ? clampToTableLimits(nextRaw, config).amounts
    : nextRaw.map(b => b.amount)
  const nextBets = nextRaw.map((b, i) => ({
    label: b.label,
    numbers: b.numbers,
    payout: b.payout,
    amount: nextAmounts[i],
  }))

  // Make the pairing honest on the leaderboard: flat betting on a self-managed
  // system IS the system as designed, and any overlay runs per cycle.
  const moneyName = placement.selfManaged
    ? money.id === 'flat'
      ? 'Built-in only'
      : `${money.name} (per cycle)`
    : money.name
  // The undecorated name, so a filter can match the underlying plan rather than
  // its display label — otherwise picking "Martingale" would silently drop every
  // self-managed system, which shows as "Martingale (per cycle)".
  const moneyBaseName = money.name

  const builtInOnly = placement.selfManaged === true && money.id === 'flat'
  const perCycleNote = placement.selfManaged
    ? 'Applied once per completed cycle of the step system, not on individual spins.'
    : undefined

  return {
    placementId: placement.id,
    placementName: placement.name,
    placementDescription: placement.description,
    placementSummary: placement.summary,
    moneyId: money.id,
    moneyName,
    moneyBaseName,
    moneyDescription: builtInOnly
      ? 'No overlay — the placement system runs its own staking progression exactly as designed.'
      : perCycleNote
        ? `${money.description} ${perCycleNote}`
        : money.description,
    moneySummary: builtInOnly
      ? {
          badge: 'No overlay',
          intro:
            'The placement system runs its own staking progression exactly as designed.',
        }
      : money.summary
        ? { ...money.summary, note: perCycleNote ?? money.summary.note }
        : perCycleNote
          ? { badge: money.name, intro: money.description, note: perCycleNote }
          : undefined,
    bankrollSeries,
    profit: bankroll - config.startingBankroll,
    wins,
    losses,
    pushes,
    sitOuts,
    totalStaked,
    maxDrawdown,
    peakStake,
    busted,
    currentStreak: streak,
    nextBets,
    swing: Math.sqrt(varianceSum),
    selfManaged: placement.selfManaged === true,
    cyclesCompleted: perCycle ? lastCycles : 0,
    limitBreaches,
    firstBreach,
    cappedSpins,
    firstCap,
    raisedSpins,
    firstRaise,
    unaffordableSpins,
    ruinedAt,
    stoppedAt,
    stopReason,
    trace,
  }
}

/** Runs every placement × money combination over the session's spins. */
export function simulateAll(
  placements: PlacementSystem[],
  moneys: MoneyManagementSystem<any>[],
  spins: Spin[],
  config: SessionConfig,
): ComboResult[] {
  const results: ComboResult[] = []
  for (const p of placements) {
    for (const m of moneys) {
      results.push(simulateCombo(p, m, spins, config))
    }
  }
  return results
}
