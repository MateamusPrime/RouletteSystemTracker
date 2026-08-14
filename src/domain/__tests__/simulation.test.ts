import { describe, expect, it } from 'vitest'
import { buildStepPlacementSystem } from '../custom/stepInterpreter'
import type { StepPlacementDef } from '../custom/types'
import { flat, martingale } from '../money/systems'
import { alwaysRed } from '../placement/systems'
import { ALL_BLACK, ALL_RED, NUMBERS_BY_DOZEN } from '../roulette'
import type { PlacementSystem } from '../placement'
import { simulateCombo } from '../simulation'
import type { Bet, SessionConfig, Spin } from '../types'

const config: SessionConfig = {
  wheelType: 'european',
  startingBankroll: 1000,
  baseUnit: 5,
}

const spins = (ns: number[]): Spin[] => ns.map(n => ({ n, ts: 0 }))

/** A placement system that always makes exactly the bets it is given. */
function fixedBets(bets: Bet[]): PlacementSystem {
  return { id: 'fixed', name: 'Fixed', description: '', bets: () => bets }
}

describe('payout maths', () => {
  it('pays an even-money win and takes the stake on a loss', () => {
    const win = simulateCombo(alwaysRed, flat, spins([1]), config)
    expect(win.profit).toBe(5)
    expect(win.wins).toBe(1)

    const loss = simulateCombo(alwaysRed, flat, spins([2]), config)
    expect(loss.profit).toBe(-5)
    expect(loss.losses).toBe(1)
  })

  it('loses even-money bets to the zero', () => {
    const result = simulateCombo(alwaysRed, flat, spins([0]), config)
    expect(result.profit).toBe(-5)
  })

  it('settles a mixed board of inside bets correctly', () => {
    // 2u street 4-5-6 (11:1), 1u corner 5-6-8-9 (8:1), 1u split 8-11 (17:1),
    // 1u six line 1-6 (5:1). A 5 wins the street, corner and six line.
    const system = fixedBets([
      { label: 'street', numbers: [4, 5, 6], payout: 11, units: 2 },
      { label: 'corner', numbers: [5, 6, 8, 9], payout: 8, units: 1 },
      { label: 'split', numbers: [8, 11], payout: 17, units: 1 },
      { label: 'six line', numbers: [1, 2, 3, 4, 5, 6], payout: 5, units: 1 },
    ])
    const result = simulateCombo(system, flat, spins([5]), config)
    // (2*11 + 1*8 + 1*5 - 1) = 34 units at $5 = $170
    expect(result.profit).toBe(170)
  })

  it('tracks drawdown and the busted flag', () => {
    // Stakes exactly the bankroll ($1000 = 200 units) and loses it.
    const allIn = fixedBets([
      { label: 'straight 1', numbers: [1], payout: 35, units: 200 },
    ])
    const result = simulateCombo(allIn, flat, spins([2]), config)
    expect(result.busted).toBe(true)
    expect(result.maxDrawdown).toBe(1000)
    // Losing the lot also ends the session, on the spin it happened.
    expect(result.ruinedAt).toBe(1)
    expect(result.unaffordableSpins).toBe(0) // it could afford the bet it made
  })
})

describe('bankroll affordability', () => {
  const broke: SessionConfig = { ...config, startingBankroll: 30 }

  it('stops for good once the bankroll is gone', () => {
    // Flat $5 on red: six losses empty the $30 bankroll on spin 6.
    const blacks = spins([2, 4, 6, 8, 10, 11, 13])
    const result = simulateCombo(alwaysRed, flat, blacks, broke, { trace: true })
    expect(result.busted).toBe(true)
    expect(result.ruinedAt).toBe(6)
    // The bankroll stops at zero rather than going negative.
    expect(result.profit).toBe(-30)
    // Nothing is wagered after the money runs out.
    const afterRuin = result.trace!.slice(6)
    expect(afterRuin.every(t => t.staked === 0 && t.outcome === 'sit-out')).toBe(true)
    expect(afterRuin[0].violations[0]).toContain('no longer playing')
    // And it has nothing to suggest for the next spin either.
    expect(result.nextBets).toEqual([])
  })

  it('never resumes once it could not cover a required bet', () => {
    // A system that needs $60 up front but would only need $5 later must not
    // quietly start playing again with the change in its pocket.
    const expensiveThenCheap: PlacementSystem = {
      id: 'x',
      name: 'X',
      description: '',
      bets: ({ spins: history }) => [
        {
          label: 'red',
          numbers: [1],
          payout: 1,
          units: history.length === 0 ? 12 : 1, // $60 first, then $5
        },
      ],
    }
    const result = simulateCombo(expensiveThenCheap, flat, spins([2, 2, 2]), broke)
    expect(result.ruinedAt).toBe(1)
    expect(result.sitOuts).toBe(3)
    expect(result.totalStaked).toBe(0)
    expect(result.profit).toBe(0)
  })

  it('never lets a progression bet money that was never there', () => {
    const blacks = spins([2, 4, 6, 8, 10, 11, 13, 15])
    const result = simulateCombo(alwaysRed, martingale, blacks, broke)
    // 5 + 10 = 15 staked, then $20 is unaffordable from a $15 balance.
    expect(result.ruinedAt).toBe(3)
    expect(result.profit).toBeGreaterThanOrEqual(-30)
  })

  it('reports no ruin when the bankroll comfortably covers everything', () => {
    const result = simulateCombo(alwaysRed, flat, spins([2, 4, 6]), config)
    expect(result.ruinedAt).toBeNull()
    expect(result.unaffordableSpins).toBe(0)
  })
})

describe('swing (session variance)', () => {
  it('matches the textbook figure for a single even-money bet', () => {
    // One $5 bet on red at 18/37: SD = 5 x sqrt(4 x 18 x 19) / 37 ≈ $4.998
    const result = simulateCombo(alwaysRed, flat, spins([1]), config)
    const p = 18 / 37
    const expected = 5 * Math.sqrt(4 * p * (1 - p))
    expect(result.swing).toBeCloseTo(expected, 6)
  })

  it('is about six times larger for a straight-up bet of the same stake', () => {
    const straight = fixedBets([
      { label: 'straight 7', numbers: [7], payout: 35, units: 1 },
    ])
    const inside = simulateCombo(straight, flat, spins([1]), config).swing
    const outside = simulateCombo(alwaysRed, flat, spins([1]), config).swing
    // The old approximation treated these as identical, overstating how
    // significant a straight-up result looked by roughly this factor.
    expect(inside / outside).toBeGreaterThan(5)
    expect(inside / outside).toBeLessThan(6.5)
  })

  it('grows with the square root of the number of spins', () => {
    const one = simulateCombo(alwaysRed, flat, spins([1]), config).swing
    const hundred = simulateCombo(
      alwaysRed,
      flat,
      spins(Array.from({ length: 100 }, (_, i) => (i % 36) + 1)),
      config,
    ).swing
    expect(hundred / one).toBeCloseTo(10, 0)
  })

  it('sees no swing at all when nothing was ever staked', () => {
    const sitter: PlacementSystem = { id: 's', name: 'S', description: '', bets: () => [] }
    expect(simulateCombo(sitter, flat, spins([1, 2, 3]), config).swing).toBe(0)
  })

  it('cancels out when bets cover the whole wheel evenly', () => {
    // Red and black together leave only the zero uncovered, so the result is
    // almost always a flat push — very little swing for a lot of stake.
    const both = fixedBets([
      { label: 'red', numbers: ALL_RED, payout: 1, units: 1 },
      { label: 'black', numbers: ALL_BLACK, payout: 1, units: 1 },
    ])
    const covered = simulateCombo(both, flat, spins([1]), config)
    expect(covered.totalStaked).toBe(10)
    // Far smaller than a single $5 red bet despite twice the money down.
    expect(covered.swing).toBeLessThan(2)
  })
})

describe('table limits', () => {
  const limited: SessionConfig = {
    ...config,
    tableMin: 5,
    tableMaxOutside: 500,
    tableMaxInside: 100,
  }

  it('flags an outside bet above the table maximum', () => {
    // Eight straight blacks push Martingale on red to $640 on the last spin.
    const blacks = spins([2, 4, 6, 8, 10, 11, 13, 15])
    const result = simulateCombo(alwaysRed, martingale, blacks, limited)
    expect(result.limitBreaches).toBe(1)
    expect(result.firstBreach).toContain('red $640.00 is over the $500 outside maximum')
  })

  it('passes a flat bettor who never leaves the limits', () => {
    const blacks = spins([2, 4, 6, 8, 10, 11, 13, 15])
    expect(simulateCombo(alwaysRed, flat, blacks, limited).limitBreaches).toBe(0)
  })

  it('flags an inside bet above the inside maximum', () => {
    const system = fixedBets([
      { label: 'straight 7', numbers: [7], payout: 35, units: 30 }, // $150
    ])
    const result = simulateCombo(system, flat, spins([7]), limited)
    expect(result.limitBreaches).toBe(1)
    expect(result.firstBreach).toContain('straight 7 $150.00 is over the $100 inside maximum')
  })

  it('flags an inside total below the table minimum', () => {
    const system = fixedBets([
      { label: 'straight 7', numbers: [7], payout: 35, units: 0.2 }, // $1
    ])
    const result = simulateCombo(system, flat, spins([7]), limited)
    expect(result.firstBreach).toContain('inside bets total $1.00 is below the $5 minimum')
  })

  it('reads as a sentence when a single outside bet is under the minimum', () => {
    const system = fixedBets([{ label: 'red', numbers: [1, 3], payout: 1, units: 0.4 }]) // $2
    const result = simulateCombo(system, flat, spins([1]), limited)
    expect(result.firstBreach).toContain('red $2.00 is below the $5 minimum')
  })

  it('checks nothing when limits are unset', () => {
    const blacks = spins([2, 4, 6, 8, 10, 11, 13, 15])
    expect(simulateCombo(alwaysRed, martingale, blacks, config).limitBreaches).toBe(0)
  })
})

describe('per-payout table maximums', () => {
  const straight30 = fixedBets([
    { label: 'straight 7', numbers: [7], payout: 35, units: 30 }, // $150
  ])

  it('applies a 35:1 ceiling that the coarse inside maximum would have allowed', () => {
    const cfg: SessionConfig = { ...config, tableMaxInside: 500, tableMaxByPayout: { '35': 100 } }
    const result = simulateCombo(straight30, flat, spins([7]), cfg)
    expect(result.limitBreaches).toBe(1)
    expect(result.firstBreach).toContain('over the $100 35:1 maximum')
  })

  it('leaves other tiers alone — a dozen is untouched by a straight-up limit', () => {
    const dozen = fixedBets([
      { label: 'dozen 1', numbers: [1, 2, 3], payout: 2, units: 60 }, // $300
    ])
    const cfg: SessionConfig = { ...config, tableMaxByPayout: { '35': 100 } }
    expect(simulateCombo(dozen, flat, spins([1]), cfg).limitBreaches).toBe(0)
  })

  it('falls back to the coarse maximum for a tier left blank', () => {
    const cfg: SessionConfig = { ...config, tableMaxInside: 100, tableMaxByPayout: { '2': 500 } }
    const result = simulateCombo(straight30, flat, spins([7]), cfg)
    expect(result.firstBreach).toContain('over the $100 inside maximum')
  })

  it('caps to the tier ceiling when clamping, so the win is only the ceiling', () => {
    const cfg: SessionConfig = {
      ...config,
      startingBankroll: 5000,
      tableMaxByPayout: { '35': 100 },
      clampToLimits: true,
    }
    const result = simulateCombo(straight30, flat, spins([7]), cfg)
    expect(result.cappedSpins).toBe(1)
    // Bet capped $150 -> $100, and a hit pays 35:1 on the $100 actually down.
    expect(result.totalStaked).toBe(100)
    expect(result.profit).toBe(3500)
  })
})

describe('table minimum lifts a bet rather than capping it', () => {
  it('counts a lift separately from a cut, and records which way it went', () => {
    // One tiny outside bet: below the minimum, so it is pushed UP.
    const tiny = fixedBets([{ label: 'red', numbers: [1, 3], payout: 1, units: 0.2 }]) // $1
    const cfg: SessionConfig = { ...config, tableMin: 5, clampToLimits: true }
    const result = simulateCombo(tiny, flat, spins([1]), cfg, { trace: true })

    expect(result.raisedSpins).toBe(1)
    expect(result.cappedSpins).toBe(0)
    expect(result.firstRaise).toContain('$1.00 → $5.00')
    expect(result.firstCap).toBeNull()
    // The placed bet is the minimum, and the wanted amount is recorded below it.
    const bet = result.trace![0].bets[0]
    expect(bet.amount).toBe(5)
    expect(bet.requested).toBe(1)
    expect(bet.amount).toBeGreaterThan(bet.requested!)
  })

  it('still counts a cut as a cut', () => {
    const big = fixedBets([{ label: 'red', numbers: [1, 3], payout: 1, units: 200 }]) // $1000
    const cfg: SessionConfig = {
      ...config,
      startingBankroll: 5000,
      tableMaxOutside: 500,
      clampToLimits: true,
    }
    const result = simulateCombo(big, flat, spins([1]), cfg, { trace: true })
    expect(result.cappedSpins).toBe(1)
    expect(result.raisedSpins).toBe(0)
    const bet = result.trace![0].bets[0]
    expect(bet.amount).toBeLessThan(bet.requested!)
  })

  it('can do both on the same spin without confusing them', () => {
    const mixed = fixedBets([
      { label: 'red', numbers: [1, 3], payout: 1, units: 200 }, // $1000 -> cut to 500
      { label: 'black', numbers: [2, 4], payout: 1, units: 0.2 }, // $1 -> lifted to 5
    ])
    const cfg: SessionConfig = {
      ...config,
      startingBankroll: 5000,
      tableMin: 5,
      tableMaxOutside: 500,
      clampToLimits: true,
    }
    const result = simulateCombo(mixed, flat, spins([1]), cfg)
    expect(result.cappedSpins).toBe(1)
    expect(result.raisedSpins).toBe(1)
  })
})

describe('bankroll guardrails', () => {
  // Flat $5 on red; each red is +$5, each black -$5.
  const reds = spins([1, 3, 5, 7, 9, 12, 14, 16, 18, 19])

  it('stops once the win goal is reached and books the result', () => {
    const cfg: SessionConfig = { ...config, stopWin: 20 }
    const result = simulateCombo(alwaysRed, flat, reds, cfg)
    expect(result.stoppedAt).toBe(4) // four $5 wins = +$20
    expect(result.stopReason).toContain('win goal')
    expect(result.profit).toBe(20)
    // It sat out every remaining spin rather than playing on.
    expect(result.sitOuts).toBe(reds.length - 4)
  })

  it('stops once the loss limit is reached', () => {
    const blacks = spins([2, 4, 6, 8, 10, 11, 13, 15])
    const cfg: SessionConfig = { ...config, stopLoss: 15 }
    const result = simulateCombo(alwaysRed, flat, blacks, cfg)
    expect(result.stoppedAt).toBe(3)
    expect(result.stopReason).toContain('loss limit')
    expect(result.profit).toBe(-15)
  })

  it('plays the whole session when no guardrail is set', () => {
    const result = simulateCombo(alwaysRed, flat, reds, config)
    expect(result.stoppedAt).toBeNull()
    expect(result.stopReason).toBeNull()
    expect(result.profit).toBe(50)
  })
})

describe('capping bets to the table (clampToLimits)', () => {
  const capped: SessionConfig = {
    ...config,
    startingBankroll: 5000, // deep enough that the cap bites before affordability
    tableMaxOutside: 500,
    tableMaxInside: 100,
    tableMin: 5,
    clampToLimits: true,
  }

  it('places the ceiling instead of the plan’s demand', () => {
    // Seven straight blacks want $5,10,20,40,80,160,320; the 7th is capped.
    const blacks = spins([2, 4, 6, 8, 10, 11, 13])
    const result = simulateCombo(alwaysRed, martingale, blacks, capped, { trace: true })
    const stakes = result.trace!.map(t => t.staked)
    expect(stakes).toEqual([5, 10, 20, 40, 80, 160, 320])
    // No cap needed yet ($320 < $500).
    expect(result.cappedSpins).toBe(0)
  })

  it('holds a runaway Martingale at the ceiling', () => {
    // Eight blacks: the 8th wants $640 but the table only allows $500.
    const blacks = spins([2, 4, 6, 8, 10, 11, 13, 15])
    const result = simulateCombo(alwaysRed, martingale, blacks, capped, { trace: true })
    const last = result.trace![7]
    expect(last.staked).toBe(500)
    expect(last.bets[0].requested).toBe(640)
    expect(result.cappedSpins).toBe(1)
    expect(result.firstCap).toContain('$640.00 → $500.00')
    // Never flagged — it complied with the table.
    expect(result.limitBreaches).toBe(0)
  })

  it('lets a capped win recover only the ceiling, not the full demand', () => {
    // Eight blacks then a red: the winning bet is the capped $500, so the
    // player collects $500 profit on that spin — far less than the $635 of
    // prior losses. Winning the spin does not make the session whole.
    const seq = spins([2, 4, 6, 8, 10, 11, 13, 15, 1])
    const result = simulateCombo(alwaysRed, martingale, seq, capped)
    // Losses 5+10+20+40+80+160+320+500 = 1135, then +500 back = -635 net.
    expect(result.profit).toBe(-635)
  })

  it('is harsher than the flag-only mode on the same session', () => {
    const seq = spins([2, 4, 6, 8, 10, 11, 13, 15, 1])
    const withCap = simulateCombo(alwaysRed, martingale, seq, capped)
    const flagOnly = simulateCombo(alwaysRed, martingale, seq, { ...capped, clampToLimits: false })
    // Uncapped, the $640 win recovers everything and the session is even.
    expect(flagOnly.profit).toBe(5)
    // Capping the win to $500 leaves the player deep in the red.
    expect(withCap.profit).toBeLessThan(flagOnly.profit)
    expect(withCap.profit).toBe(-635)
  })

  it('raises a too-small outside bet up to the minimum', () => {
    const tiny = fixedBets([{ label: 'red', numbers: ALL_RED, payout: 1, units: 0.2 }]) // $1
    const result = simulateCombo(tiny, flat, spins([1]), capped, { trace: true })
    expect(result.trace![0].staked).toBe(5) // raised to the $5 minimum
    // A lift is not a cap: it counts on the other side of the ledger.
    expect(result.raisedSpins).toBe(1)
    expect(result.cappedSpins).toBe(0)
  })

  it('caps an inside bet to the inside maximum', () => {
    const big = fixedBets([{ label: 'straight 7', numbers: [7], payout: 35, units: 30 }]) // $150
    const result = simulateCombo(big, flat, spins([7]), capped, { trace: true })
    expect(result.trace![0].staked).toBe(100)
    // Won at the capped $100: +$3500.
    expect(result.profit).toBe(3500)
  })
})

describe('self-managed step systems', () => {
  const ladder: StepPlacementDef = {
    variant: 'steps',
    id: 'ladder',
    name: 'Ladder',
    description: '',
    steps: [
      {
        name: 'Base',
        funding: { type: 'fixed' },
        bets: [{ target: { kind: 'fixed', bet: 'red' }, units: 1 }],
        next: ['restart', 1],
      },
      {
        name: 'Climb',
        funding: { type: 'fixed' },
        bets: [{ target: { kind: 'fixed', bet: 'red' }, units: 2 }],
        next: ['restart', 'restart'],
      },
    ],
  }
  const system = buildStepPlacementSystem(ladder)
  // 1 red (climb), 2 black (cycle lost), repeating.
  const script = spins([1, 2, 3, 4, 5, 6])

  it('runs the system as designed on flat betting', () => {
    const result = simulateCombo(system, flat, script, config, { trace: true })
    expect(result.moneyName).toBe('Built-in only')
    expect(result.trace!.map(t => t.staked)).toEqual([5, 10, 5, 10, 5, 10])
  })

  it('keeps the plain plan name so a filter still matches it', () => {
    // The display name is decorated for self-managed systems; filtering on that
    // would silently exclude every one of them.
    const result = simulateCombo(system, martingale, script, config)
    expect(result.moneyName).toBe('Martingale (per cycle)')
    expect(result.moneyBaseName).toBe('Martingale')
    // Flat reads as "Built-in only" but is still Flat Betting underneath.
    expect(simulateCombo(system, flat, script, config).moneyBaseName).toBe('Flat Betting')
  })

  it('escalates an overlay per cycle, not per spin', () => {
    const result = simulateCombo(system, martingale, script, config, { trace: true })
    expect(result.moneyName).toBe('Martingale (per cycle)')
    // The stake holds steady inside a cycle and doubles only after a losing one.
    expect(result.trace!.map(t => t.staked)).toEqual([5, 10, 10, 20, 20, 40])
    expect(result.cyclesCompleted).toBe(3)
  })
})

describe('GB systems (independent legs, shared bankroll)', () => {
  /** Two legs: one on red, one on dozen 1, each with its own progression. */
  const twoLegs: PlacementSystem = {
    id: 'gb',
    name: 'GB',
    description: '',
    bets: () => [
      { label: 'red', numbers: ALL_RED, payout: 1, units: 1, leg: 'red' },
      { label: 'dozen 1', numbers: NUMBERS_BY_DOZEN[1], payout: 2, units: 1, leg: 'dozen 1' },
    ],
  }

  it('escalates each leg only on its own result', () => {
    // 20 is black and in dozen 2, so BOTH legs lose the first spin.
    // 3 is red and in dozen 1, so both legs win the second.
    const result = simulateCombo(twoLegs, martingale, spins([20, 3]), config, { trace: true })
    const [first, second] = result.trace!
    expect(first.bets.map(b => b.amount)).toEqual([5, 5])
    // Both lost, so both legs double.
    expect(second.bets.map(b => b.amount)).toEqual([10, 10])
  })

  it('keeps a losing leg escalating while a winning leg resets', () => {
    // 3 is red (red wins) and in dozen 1 (dozen wins) — both reset.
    // 20 is black (red loses) and dozen 2 (dozen loses) — both double.
    // 5 is red (red wins → reset) but dozen 1 too... use 25: red? 25 is red,
    // dozen 3. So red wins and resets; dozen 1 loses and doubles again.
    const result = simulateCombo(twoLegs, martingale, spins([20, 25, 25]), config, {
      trace: true,
    })
    const amounts = result.trace!.map(t => t.bets.map(b => b.amount))
    expect(amounts[0]).toEqual([5, 5]) // both open at one unit
    expect(amounts[1]).toEqual([10, 10]) // both lost on 20
    // 25 is red and in dozen 3: red won (resets to 5), dozen 1 lost (doubles to 20).
    expect(amounts[2]).toEqual([5, 20])
  })

  it('draws every leg from the one bankroll', () => {
    const result = simulateCombo(twoLegs, flat, spins([20]), config, { trace: true })
    // Two $5 bets both lose: the shared bankroll drops by the total.
    expect(result.trace![0].staked).toBe(10)
    expect(result.profit).toBe(-10)
  })

  it('stops the whole system when the shared bankroll cannot cover the legs', () => {
    const tiny: SessionConfig = { ...config, startingBankroll: 12 }
    const result = simulateCombo(twoLegs, flat, spins([20, 20, 20]), tiny)
    // $10 a spin: affordable once, then only $2 remains.
    expect(result.ruinedAt).toBe(2)
    expect(result.profit).toBe(-10)
  })
})

describe('spin traces', () => {
  it('records each spin with its bets, result and running bankroll', () => {
    const result = simulateCombo(alwaysRed, flat, spins([1, 2]), config, { trace: true })
    expect(result.trace).toHaveLength(2)
    const [first, second] = result.trace!
    expect(first.bets[0].won).toBe(true)
    expect(first.net).toBe(5)
    expect(first.bankroll).toBe(1005)
    expect(second.bets[0].won).toBe(false)
    expect(second.bankroll).toBe(1000)
  })

  it('omits the trace unless it is asked for', () => {
    expect(simulateCombo(alwaysRed, flat, spins([1]), config).trace).toBeUndefined()
  })
})
