import { describe, expect, it } from 'vitest'
import { DEFAULT_WARMUP, followTheLeader } from '../followLeader'
import { flat, paroli } from '../money/systems'
import { alwaysBlack, alwaysRed } from '../placement/systems'
import { simulateAll } from '../simulation'
import type { SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 1000,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))

const RED = 1
const BLACK = 2

/** Matches how the model labels a combo, for looking one up by name. */
const nameOf = (r: { placementName: string; moneyName: string }) =>
  `${r.placementName} × ${r.moneyName}`

/** Two opposed systems make the leader unambiguous on any given spin. */
const PLACEMENTS = [alwaysRed, alwaysBlack]
const MONEYS = [flat]

function run(ns: number[], warmup = DEFAULT_WARMUP) {
  const s = spins(ns)
  const results = simulateAll(PLACEMENTS, MONEYS, s, config)
  return followTheLeader(results, PLACEMENTS, MONEYS, s, config, { warmup })
}

describe('follow the leader', () => {
  it('sits out the warm-up rather than acting on a board that means nothing', () => {
    const r = run([RED, RED, RED, RED, RED, RED], 5)
    expect(r.steps.slice(0, 5).every(s => s.followedKey === null)).toBe(true)
    expect(r.steps[0].note).toContain('warming up')
    expect(r.sitOuts).toBeGreaterThanOrEqual(5)
    // Only the sixth spin was actually played.
    expect(r.totalStaked).toBe(5)
  })

  it('follows whoever leads and books the real result', () => {
    // Five reds put Always Red on top; the sixth is red too, so following wins.
    const r = run([RED, RED, RED, RED, RED, RED], 5)
    expect(r.steps[5].followedName).toContain('Always Red')
    expect(r.steps[5].net).toBe(5)
    expect(r.profit).toBe(5)
  })

  it('never peeks ahead — it backs the past leader even when that loses', () => {
    // Five reds crown Always Red, then black hits. A model with hindsight would
    // have switched first; this one takes the loss, which is the honest result.
    const r = run([RED, RED, RED, RED, RED, BLACK], 5)
    expect(r.steps[5].followedName).toContain('Always Red')
    expect(r.steps[5].net).toBe(-5)
    expect(r.profit).toBe(-5)
  })

  it('switches when the lead changes, and counts the switch', () => {
    // Reds crown Always Red; then enough blacks to hand the lead to Always Black.
    const r = run([RED, RED, RED, RED, RED, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK], 5)
    const followed = r.steps.slice(5).map(s => s.followedName)
    expect(followed[0]).toContain('Always Red')
    expect(followed[followed.length - 1]).toContain('Always Black')
    expect(r.switches).toBeGreaterThanOrEqual(1)
    expect(r.distinctFollowed).toBe(2)
  })

  it('stays put when the field is level instead of churning', () => {
    // Alternating red/black keeps both systems dead level for long stretches.
    const r = run([RED, BLACK, RED, BLACK, RED, BLACK, RED, BLACK, RED, BLACK], 5)
    // At most one switch: the incumbent is only displaced by a strict lead.
    expect(r.switches).toBeLessThanOrEqual(1)
  })

  it('reports the controls that make the result judgeable', () => {
    const r = run([RED, RED, RED, RED, RED, RED, RED, RED], 5)
    expect(r.lockInName).toContain('Always Red')
    // Committing at the warm-up would have caught the last three reds.
    expect(r.lockInProfit).toBe(15)
    expect(r.bestHindsightName).toContain('Always Red')
    expect(r.bestHindsightProfit).toBe(40)
    // Always Red +40, Always Black -40 on eight reds.
    expect(r.averageProfit).toBe(0)
  })

  it('keeps one bankroll across switches', () => {
    const r = run([RED, RED, RED, RED, RED, RED, BLACK, BLACK], 5)
    // Bankroll series tracks the follower's own money, not any one combo's.
    expect(r.bankrollSeries[0]).toBe(config.startingBankroll)
    expect(r.bankrollSeries[r.bankrollSeries.length - 1]).toBe(
      config.startingBankroll + r.profit,
    )
    expect(r.bankrollSeries.length).toBe(9)
  })

  it('skips a bet it cannot cover but keeps playing', () => {
    // $6 covers one $5 bet; after losing it, $1 cannot cover the next $5 — but
    // that is being priced out of one bet, not being broke.
    const thin: SessionConfig = { ...config, startingBankroll: 6 }
    const s = spins([RED, RED, RED, RED, RED, BLACK, BLACK, BLACK])
    const results = simulateAll(PLACEMENTS, MONEYS, s, thin)
    const r = followTheLeader(results, PLACEMENTS, MONEYS, s, thin, { warmup: 5 })
    expect(r.skippedBets).toBeGreaterThan(0)
    expect(r.biggestSkip).toBeGreaterThan(0)
    expect(r.ruinedAt).toBeNull()
    expect(r.steps.some(st => st.note?.includes('skipped, still playing'))).toBe(true)
    // Still following the board on the final spin rather than having quit.
    expect(r.steps[r.steps.length - 1].followedKey).not.toBeNull()
  })

  it('a skip never ends the session', () => {
    const thin: SessionConfig = { ...config, startingBankroll: 6 }
    const s = spins([RED, RED, RED, RED, RED, BLACK, RED, RED, BLACK])
    const results = simulateAll(PLACEMENTS, MONEYS, s, thin)
    const r = followTheLeader(results, PLACEMENTS, MONEYS, s, thin, { warmup: 5 })
    const skipIndex = r.steps.findIndex(st => st.note?.includes('skipped'))
    expect(skipIndex).toBeGreaterThan(-1)
    // The old model quit here for good; every later spin must still be live.
    expect(r.ruinedAt).toBeNull()
    expect(r.steps.slice(skipIndex + 1).every(st => !st.note?.includes('bankroll gone'))).toBe(true)
    expect(r.steps.slice(skipIndex + 1).every(st => st.followedKey !== null)).toBe(true)
  })

  it('only calls it ruin when the bankroll is actually gone', () => {
    const broke: SessionConfig = { ...config, startingBankroll: 5 }
    const s = spins([RED, RED, RED, RED, RED, BLACK, BLACK, BLACK])
    const results = simulateAll(PLACEMENTS, MONEYS, s, broke)
    const r = followTheLeader(results, PLACEMENTS, MONEYS, s, broke, { warmup: 5 })
    // The single $5 bet loses and leaves nothing at all.
    expect(r.ruinedAt).toBe(6)
    expect(r.steps.some(st => st.note?.includes('bankroll gone'))).toBe(true)
  })

  it('opens at the base stake in fresh mode instead of inheriting a step', () => {
    // Paroli doubles on wins, so the LEADER is the one deep in its progression.
    // Stepping on at spin 6 should still cost one unit, not the board's step.
    const P = [alwaysRed, alwaysBlack]
    const M = [paroli]
    const s = spins([BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK])
    const results = simulateAll(P, M, s, config)

    const copied = followTheLeader(results, P, M, s, config, { warmup: 5 })
    const own = followTheLeader(results, P, M, s, config, {
      warmup: 5,
      freshProgressions: true,
    })
    const firstCopied = copied.steps.find(x => x.bets.length > 0)
    const firstOwn = own.steps.find(x => x.bets.length > 0)

    expect(firstOwn!.staked).toBe(config.baseUnit)
    // The board is deep into its progression, so copying costs far more.
    expect(firstCopied!.staked).toBeGreaterThan(firstOwn!.staked)
  })

  it('restarts the progression when the lead changes', () => {
    const P = [alwaysRed, alwaysBlack]
    const M = [paroli]
    // Reds crown Always Red, then a long black run hands the lead over.
    const s = spins([RED, RED, RED, RED, RED, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK])
    const results = simulateAll(P, M, s, config)
    const own = followTheLeader(results, P, M, s, config, {
      warmup: 5,
      freshProgressions: true,
    })
    const switchStep = own.steps.find(x => x.switched && x.bets.length > 0)
    expect(switchStep).toBeDefined()
    // A switch opens the new combo at its first stake.
    expect(switchStep!.staked).toBe(config.baseUnit)
  })

  it('still follows the same combos in fresh mode — only the stakes differ', () => {
    const P = [alwaysRed, alwaysBlack]
    const M = [paroli]
    const s = spins([RED, RED, RED, RED, RED, BLACK, BLACK, BLACK, RED, RED])
    const results = simulateAll(P, M, s, config)
    const copied = followTheLeader(results, P, M, s, config, { warmup: 5 })
    const own = followTheLeader(results, P, M, s, config, {
      warmup: 5,
      freshProgressions: true,
    })
    expect(own.steps.map(x => x.followedKey)).toEqual(copied.steps.map(x => x.followedKey))
    expect(own.switches).toBe(copied.switches)
  })

  it('follows the hottest combo, not the richest, in trend mode', () => {
    // Ten reds build Always Red a big lead, then blacks run. Always Red is
    // still ahead overall, but Always Black is what is working right now.
    const s = spins([
      RED, RED, RED, RED, RED, RED, RED, RED, RED, RED,
      BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK,
    ])
    const results = simulateAll(PLACEMENTS, MONEYS, s, config)
    const byProfit = followTheLeader(results, PLACEMENTS, MONEYS, s, config, { warmup: 10 })
    const byTrend = followTheLeader(results, PLACEMENTS, MONEYS, s, config, {
      warmup: 10,
      leaderBy: 'trend',
      trendWindow: 5,
    })
    const lastOf = (r: typeof byProfit) => r.steps[r.steps.length - 1].followedName
    expect(lastOf(byProfit)).toContain('Always Red')
    expect(lastOf(byTrend)).toContain('Always Black')
  })

  it('collapses into profit mode when the window covers the whole session', () => {
    // Trend measured from spin 1 IS total profit, so the two must agree.
    const s = spins([RED, RED, RED, BLACK, RED, BLACK, BLACK, RED, RED, BLACK, RED, RED])
    const results = simulateAll(PLACEMENTS, MONEYS, s, config)
    const byProfit = followTheLeader(results, PLACEMENTS, MONEYS, s, config, { warmup: 5 })
    const byTrend = followTheLeader(results, PLACEMENTS, MONEYS, s, config, {
      warmup: 5,
      leaderBy: 'trend',
      trendWindow: 1000,
    })
    expect(byTrend.steps.map(x => x.followedKey)).toEqual(byProfit.steps.map(x => x.followedKey))
    expect(byTrend.profit).toBe(byProfit.profit)
  })

  it('defaults to profit so the existing behaviour is unchanged', () => {
    const s = spins([RED, RED, RED, RED, RED, BLACK, RED, BLACK])
    const results = simulateAll(PLACEMENTS, MONEYS, s, config)
    const implicit = followTheLeader(results, PLACEMENTS, MONEYS, s, config, { warmup: 5 })
    const explicit = followTheLeader(results, PLACEMENTS, MONEYS, s, config, {
      warmup: 5,
      leaderBy: 'profit',
    })
    expect(implicit.profit).toBe(explicit.profit)
  })

  it('holds the lock-in control to the same bankroll as the follower', () => {
    // The control must be a real replay of committing to that one combo, under
    // the follower's own bankroll and affordability — not a reading of the
    // combo's private curve, which was funded by a bankroll you never had.
    const thin: SessionConfig = { ...config, startingBankroll: 40 }
    const s = spins([RED, RED, RED, RED, RED, RED, RED, BLACK, RED, RED])
    const results = simulateAll(PLACEMENTS, [paroli], s, thin)
    const r = followTheLeader(results, PLACEMENTS, [paroli], s, thin, { warmup: 5 })

    const pinned = results.find(x => nameOf(x) === r.lockInName)!
    const replay = followTheLeader([pinned], PLACEMENTS, [paroli], s, thin, { warmup: 5 })
    expect(r.lockInProfit).toBe(replay.profit)
    // Committing never switches, by definition.
    expect(replay.switches).toBe(0)
  })

  it('returns an empty model when there is nothing to follow', () => {
    const r = followTheLeader([], PLACEMENTS, MONEYS, [], config)
    expect(r.profit).toBe(0)
    expect(r.steps).toEqual([])
  })
})
