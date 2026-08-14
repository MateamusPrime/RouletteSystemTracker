import { useState } from 'react'
import {
  assessCombo,
  formatMoney,
  leadIsMeaningful,
  significanceBar,
  STRICTNESS_ALPHA,
} from '../domain/confidence'
import type { StrictnessLevel } from '../domain/confidence'
import type { ComboResult } from '../domain/simulation'
import type { WheelType } from '../domain/types'
import { NextBetBoard } from './NextBetBoard'

interface Props {
  best: ComboResult | null
  runnerUp: ComboResult | null
  /** Every combo simulated — the real breadth of the search. */
  searchedCount: number
  /** How many survive the current filter. */
  shownCount: number
  /** True when the leaderboard is filtered, so the headline is scoped too. */
  filtered: boolean
  /** The player's claim that the filter predates this session's results. */
  preCommitted: boolean
  onPreCommittedChange(v: boolean): void
  wheelType: WheelType
  spinCount: number
}

/**
 * The headline answer: which combo is performing best RIGHT NOW in this
 * session, and what it wants you to bet on the next spin — paired with an
 * honest read on whether that lead means anything yet.
 */
export function Recommendation({
  best,
  runnerUp,
  searchedCount,
  shownCount,
  filtered,
  preCommitted,
  onPreCommittedChange,
  wheelType,
  spinCount,
}: Props) {
  const [level, setLevel] = useState<StrictnessLevel>('standard')

  if (!best || spinCount < 5) {
    return (
      <div className="recommendation warming">
        <div className="rec-title">Warming up…</div>
        <div className="muted">
          Record at least 5 spins and the tracker will surface the best-performing
          placement × money-management combo for this session.
        </div>
      </div>
    )
  }

  const conf = assessCombo(best, wheelType)
  // Narrowing the field only lowers the bar when the narrowing was decided in
  // advance. Otherwise the search really was the whole board, whatever is shown.
  const claimedShortlist = filtered && preCommitted
  const effectiveCount = claimedShortlist ? shownCount : searchedCount
  const verdict = leadIsMeaningful(best, runnerUp, effectiveCount, wheelType, level)
  const bar = significanceBar(effectiveCount, level)

  return (
    <div className={`recommendation ${verdict.meaningful ? '' : 'unproven'}`}>
      <div className="rec-title">
        Best combo this session{filtered && ' (of those shown)'}:{' '}
        <strong>{best.placementName}</strong> × <strong>{best.moneyName}</strong>
      </div>
      <div className="rec-body">
        <span className={best.profit >= 0 ? 'pos' : 'neg'}>
          {best.profit >= 0 ? '+' : '-'}${Math.abs(best.profit).toFixed(0)}
        </span>{' '}
        over {spinCount} spins · {best.wins}W-{best.losses}L · max drawdown $
        {best.maxDrawdown.toFixed(0)}
      </div>
      <div className="rec-next">
        <div className="stat-title">Next spin — where to place your chips</div>
        <NextBetBoard nextBets={best.nextBets} />
      </div>

      <div className={`rec-confidence ${verdict.meaningful ? 'proven' : ''}`}>
        <span className="rec-confidence-tag">
          {verdict.meaningful ? '✓ Lead stands out' : '⚠ Not meaningful yet'}
        </span>
        <span>{verdict.reason}.</span>
      </div>
      <div className="rec-maths muted">
        At the house edge this combo was expected to be down{' '}
        <strong>{formatMoney(-conf.expectedProfit)}</strong> on {formatMoney(best.totalStaked)}{' '}
        staked, so {conf.luck >= 0 ? 'it is running' : 'it is trailing'}{' '}
        <strong>{formatMoney(Math.abs(conf.luck))}</strong>{' '}
        {conf.luck >= 0 ? 'ahead of' : 'behind'} the maths — about{' '}
        <strong>{Math.abs(conf.z).toFixed(1)}</strong> standard{' '}
        {Math.abs(conf.z) === 1 ? 'deviation' : 'deviations'}, against a bar of{' '}
        <strong>{bar.toFixed(2)}</strong> for a field of {effectiveCount}.
      </div>

      <label
        className="rec-strictness muted"
        title={`Bonferroni correction: to keep the chance of ANY of ${effectiveCount} combos clearing the bar by luck at ${(STRICTNESS_ALPHA[level] * 100).toFixed(0)}%, each is tested at that level divided by ${effectiveCount}.`}
      >
        How sure do you want to be?
        <select value={level} onChange={e => setLevel(e.target.value as StrictnessLevel)}>
          {(['lenient', 'standard', 'strict'] as StrictnessLevel[]).map(l => (
            <option key={l} value={l}>
              {l} ({(STRICTNESS_ALPHA[l] * 100).toFixed(0)}% · {significanceBar(effectiveCount, l).toFixed(2)}σ)
            </option>
          ))}
        </select>
      </label>

      {filtered && (
        <label
          className="rec-precommit"
          title={
            preCommitted
              ? 'The bar is set by the filtered field. Only honest if you chose this filter before seeing the results.'
              : `Searching all ${searchedCount} combos sets the bar at ${significanceBar(searchedCount).toFixed(2)}σ. Narrowing to ${shownCount} would lower it to ${significanceBar(shownCount).toFixed(2)}σ — but only counts if you picked them in advance.`
          }
        >
          <input
            type="checkbox"
            checked={preCommitted}
            onChange={e => onPreCommittedChange(e.target.checked)}
          />
          <span>
            I chose this shortlist <strong>before</strong> seeing these results
            {preCommitted ? (
              <span className="muted">
                {' '}— bar lowered to {significanceBar(shownCount).toFixed(2)}σ for {shownCount} combos
              </span>
            ) : (
              <span className="muted">
                {' '}— until then the bar stays at {significanceBar(searchedCount).toFixed(2)}σ for all{' '}
                {searchedCount} searched
              </span>
            )}
          </span>
        </label>
      )}
      <div className="rec-disclaimer muted">
        Past session performance — roulette outcomes are independent; no system changes the house edge.
      </div>
    </div>
  )
}
