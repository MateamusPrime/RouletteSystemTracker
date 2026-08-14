import { useCallback, useEffect, useMemo, useState } from 'react'
import { colorOf, labelOf } from '../domain/roulette'
import { useArrowKeys } from '../hooks/useKeyboardNav'
import type { ComboResult } from '../domain/simulation'
import { BoardView } from './BoardView'
import { ComboTimeline } from './ComboTimeline'
import { profitPerHundred } from './Leaderboard'
import { NextBetBoard } from './NextBetBoard'

interface Props {
  combo: ComboResult | null
  startingBankroll: number
}

function money(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ?? ''}`}>{value}</span>
    </div>
  )
}

/**
 * One container for everything about the selected combo: the headline numbers,
 * the bankroll curve that doubles as a scrubber, and the detail for whichever
 * spin is in focus. The spin-by-spin table this replaced pushed the felt far
 * enough down the page that you could not see both at once.
 */
export function ComboPanel({ combo, startingBankroll }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const trace = combo?.trace ?? []
  const lastSpin = Math.max(trace.length - 1, 0)

  // Left/right scrubs the timeline; the leaderboard owns up/down.
  const stepSpin = useCallback(
    (delta: number) =>
      setSelected(cur => Math.min(Math.max((cur ?? lastSpin) + delta, 0), lastSpin)),
    [lastSpin],
  )
  useArrowKeys(
    useMemo(
      () => ({ left: () => stepSpin(-1), right: () => stepSpin(1) }),
      [stepSpin],
    ),
    trace.length > 0,
  )

  /**
   * Multi-leg systems bet a changing subset each spin, so knowing which legs
   * are absent matters as much as which are present. The full roster is the
   * union across the session.
   */
  const allLegs = useMemo(() => {
    const seen = new Set<string>()
    for (const t of trace) for (const b of t.bets) seen.add(b.label)
    return [...seen]
  }, [trace])

  // A different combo means a different session to walk through.
  useEffect(() => {
    setSelected(null)
  }, [combo?.placementId, combo?.moneyId])

  const focusIndex = selected ?? lastSpin
  const entry = trace[focusIndex]

  /**
   * The focused spin split by leg. A leg's own net is what advances its
   * progression — not the spin's total — so this is the view that explains why
   * a stake went up after a spin the session as a whole won.
   *
   * Declared before the early return below: hooks must run in the same order on
   * every render, whether or not a combo is selected.
   */
  const legBreakdown = useMemo(() => {
    const rows = new Map<string, { leg: string; chips: number; each: number; staked: number; net: number }>()
    for (const b of entry?.bets ?? []) {
      const leg = b.leg ?? '—'
      const row = rows.get(leg) ?? { leg, chips: 0, each: b.amount, staked: 0, net: 0 }
      row.chips++
      row.staked += b.amount
      row.net += b.won ? b.amount * b.payout : -b.amount
      rows.set(leg, row)
    }
    return [...rows.values()].sort((a, b) => a.leg.localeCompare(b.leg))
  }, [entry])

  if (!combo) {
    return (
      <div className="panel">
        <div className="panel-title">Combo Detail</div>
        <span className="muted">
          Pick a combo in the leaderboard to see how its session played out.
        </span>
      </div>
    )
  }

  const decided = combo.wins + combo.losses
  const per100 = profitPerHundred(combo)
  const step = stepSpin
  const liveLegs = new Set((entry?.bets ?? []).map(b => b.label))

  return (
    <div className="panel combo-panel">
      <div className="combo-panel-head">
        <span className="panel-title">
          {combo.placementName} × {combo.moneyName}
        </span>
        {trace.length > 0 && (
          <div className="review-nav">
            <button
              className="btn btn-small"
              onClick={() => step(-1)}
              disabled={focusIndex <= 0}
              title="Previous spin"
            >
              ◀ Prev
            </button>
            <span className="muted review-counter">
              Spin {focusIndex + 1} of {trace.length}
              {selected === null && ' (latest)'}
            </span>
            <button
              className="btn btn-small"
              onClick={() => step(1)}
              disabled={focusIndex >= lastSpin}
              title="Next spin"
            >
              Next ▶
            </button>
            {selected !== null && (
              <button className="btn btn-small" onClick={() => setSelected(null)}>
                Latest ⏭
              </button>
            )}
          </div>
        )}
      </div>

      <div className="kpi-strip">
        <Kpi
          label="Profit"
          value={money(combo.profit)}
          tone={combo.profit >= 0 ? 'pos' : 'neg'}
        />
        <Kpi
          label="Win rate"
          value={decided === 0 ? '—' : `${((combo.wins / decided) * 100).toFixed(0)}%`}
        />
        <Kpi label="Staked" value={money(combo.totalStaked)} />
        <Kpi
          label="Per $100 staked"
          value={per100 === null ? '—' : `${per100 >= 0 ? '+' : '-'}$${Math.abs(per100).toFixed(2)}`}
          tone={per100 === null ? undefined : per100 >= 0 ? 'pos' : 'neg'}
        />
        <Kpi label="Peak stake" value={money(combo.peakStake)} />
        <Kpi label="Max drawdown" value={money(combo.maxDrawdown)} />
        {combo.selfManaged && <Kpi label="Cycles" value={String(combo.cyclesCompleted)} />}
        {combo.ruinedAt !== null && (
          <Kpi
            label="Out of money"
            value={`Spin ${combo.ruinedAt}`}
            tone="neg"
          />
        )}
        {combo.stoppedAt !== null && (
          <Kpi label="Walked away" value={`Spin ${combo.stoppedAt}`} />
        )}
        {combo.cappedSpins > 0 && (
          <Kpi label="Cut to table max" value={String(combo.cappedSpins)} />
        )}
        {combo.raisedSpins > 0 && (
          <Kpi label="Lifted to table min" value={String(combo.raisedSpins)} />
        )}
      </div>

      {combo.selfManaged && (
        <div className="muted hint combo-panel-note">
          {combo.moneyId === 'flat'
            ? 'This system runs its own staking progression — no overlay is applied.'
            : 'The overlay resolves once per completed cycle, not on the intermediate spins its own progression absorbs.'}
        </div>
      )}

      <div className="next-bet-block">
        <div className="stat-title">
          Next spin — where to place your chips
          {combo.ruinedAt !== null && <span className="muted"> (out of money)</span>}
          {combo.stoppedAt !== null && <span className="muted"> (walked away)</span>}
        </div>
        <NextBetBoard
          nextBets={combo.nextBets}
          emptyLabel={
            combo.stoppedAt !== null
              ? `Walked away on spin ${combo.stoppedAt} — ${combo.stopReason}`
              : combo.ruinedAt !== null
                ? 'Out of money — no bet to place'
                : 'This combo sits out the next spin'
          }
        />
      </div>

      {trace.length === 0 ? (
        <span className="muted">Record spins to see this combo play out.</span>
      ) : (
        <div className="combo-panel-body">
          <div className="combo-panel-timeline">
            <ComboTimeline
              trace={trace}
              startingBankroll={startingBankroll}
              selected={focusIndex}
              onSelect={setSelected}
              ruinedAt={combo.ruinedAt}
              stoppedAt={combo.stoppedAt}
            />
          </div>

          <div className="combo-panel-spin">
            {entry && (
              <>
                <div className="review-spin-head">
                  <span className={`chip ${colorOf(entry.n)} big`}>{labelOf(entry.n)}</span>
                  <span>
                    Spin {entry.index + 1}
                    {entry.outcome === 'sit-out' ? (
                      <span className="muted"> · no bet placed</span>
                    ) : (
                      <>
                        {' · '}
                        <span className={entry.net > 0 ? 'pos' : entry.net < 0 ? 'neg' : ''}>
                          {entry.net > 0 ? '+' : ''}
                          {money(entry.net)}
                        </span>
                        <span className="muted"> on {money(entry.staked)}</span>
                      </>
                    )}
                  </span>
                  <span className="muted spin-bankroll">{money(entry.bankroll)}</span>
                </div>

                <BoardView bets={entry.bets} hit={entry.n} />

                {/* Each leg carries its own progression, so a spin can be a win
                    overall while an individual leg lost and correctly staked up
                    next time. That is only auditable per leg. */}
                {legBreakdown.some(l => l.leg !== '—') && (
                  <div className="leg-ledger">
                    <div className="stat-title">
                      This spin by leg — each runs its own progression
                    </div>
                    <table className="review-bets">
                      <thead>
                        <tr>
                          <th>Leg</th>
                          <th className="num">Chips</th>
                          <th className="num">Each</th>
                          <th className="num">Staked</th>
                          <th className="num">Net</th>
                          <th>Next stake moves</th>
                        </tr>
                      </thead>
                      <tbody>
                        {legBreakdown.map(l => (
                          <tr key={l.leg}>
                            <td>{l.leg}</td>
                            <td className="num">{l.chips}</td>
                            <td className="num">{money(l.each)}</td>
                            <td className="num">{money(l.staked)}</td>
                            <td className={`num ${l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : ''}`}>
                              {l.net > 0 ? '+' : ''}
                              {money(l.net)}
                            </td>
                            <td className={l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : 'muted'}>
                              {l.net > 0 ? 'as after a win' : l.net < 0 ? 'as after a loss' : 'unchanged'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {entry.bets.length > 0 && (
                  <table className="review-bets">
                    <thead>
                      <tr>
                        <th>Bet</th>
                        <th className="num">Amount</th>
                        <th className="num">Pays</th>
                        <th className="num">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.bets.map((b, bi) => (
                        <tr
                          key={bi}
                          className={
                            b.requested === undefined
                              ? ''
                              : b.amount < b.requested
                                ? 'capped-row'
                                : 'raised-row'
                          }
                        >
                          <td>{b.label}</td>
                          <td className="num">
                            {money(b.amount)}
                            {b.requested !== undefined && (
                              <span
                                className={b.amount < b.requested ? 'capped-note' : 'raised-note'}
                                title={
                                  b.amount < b.requested
                                    ? `Wanted ${money(b.requested)} — cut down to the table maximum`
                                    : `Wanted ${money(b.requested)} — lifted up to the table minimum`
                                }
                              >
                                {' '}
                                {b.amount < b.requested ? '▼' : '▲'} from {money(b.requested)}
                              </span>
                            )}
                          </td>
                          <td className="num">{b.payout}:1</td>
                          <td className={`num ${b.won ? 'pos' : 'neg'}`}>
                            {b.won ? `+${money(b.amount * b.payout)}` : `-${money(b.amount)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {allLegs.length > 1 && (
                  <div className="leg-status">
                    <div className="stat-title">
                      Legs this spin — {liveLegs.size} live, {allLegs.length - liveLegs.size}{' '}
                      standing down
                    </div>
                    <div className="leg-chips">
                      {allLegs.map(leg => (
                        <span
                          key={leg}
                          className={`leg-chip ${liveLegs.has(leg) ? 'live' : 'down'}`}
                          title={
                            liveLegs.has(leg)
                              ? 'Betting this spin'
                              : 'Not bet this spin — already won, or its trigger has not fired'
                          }
                        >
                          {leg}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {entry.violations.length > 0 && (
                  <div className="review-violations">{entry.violations.join(' · ')}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
