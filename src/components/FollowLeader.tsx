import { useMemo, useState } from 'react'
import { DEFAULT_WARMUP, followTheLeader } from '../domain/followLeader'
import type { LeaderBy } from '../domain/followLeader'
import { bandsForFollowSteps } from '../domain/timelineBands'
import { DEFAULT_TREND_WINDOW, TREND_WINDOWS } from './Leaderboard'
import type { ComboResult } from '../domain/simulation'
import type { MoneyManagementSystem } from '../domain/money/types'
import type { PlacementSystem } from '../domain/placement/types'
import type { Session } from '../domain/types'
import { BandLegend } from './BandLegend'
import { Sparkline } from './Sparkline'

interface Props {
  results: ComboResult[]
  placements: PlacementSystem[]
  moneys: MoneyManagementSystem<any>[]
  session: Session
}

function money(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`
}

function Card({
  label,
  value,
  hint,
  tone,
  primary,
}: {
  label: string
  value: number
  hint: string
  tone?: boolean
  primary?: boolean
}) {
  return (
    <div className={`follow-card ${primary ? 'primary' : ''}`} title={hint}>
      <div className="follow-card-label">{label}</div>
      <div className={`follow-card-value ${tone ? (value >= 0 ? 'pos' : 'neg') : ''}`}>
        {signed(value)}
      </div>
      <div className="muted follow-card-hint">{hint}</div>
    </div>
  )
}

/**
 * "If you had listened to me at every spin, where would you be?"
 *
 * Plays the leaderboard's top combo forward one spin at a time, deciding the
 * leader only from spins already recorded, and shows the result next to the
 * controls that give it meaning: committing to the early leader, the best combo
 * in hindsight, and the field average.
 */
export function FollowLeader({ results, placements, moneys, session }: Props) {
  const [warmup, setWarmup] = useState(DEFAULT_WARMUP)
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [leaderBy, setLeaderBy] = useState<LeaderBy>('profit')
  const [trendWindow, setTrendWindow] = useState<number>(DEFAULT_TREND_WINDOW)

  const model = useMemo(
    () =>
      followTheLeader(results, placements, moneys, session.spins, session.config, {
        warmup,
        freshProgressions: fresh,
        leaderBy,
        trendWindow,
      }),
    [results, placements, moneys, session.spins, session.config, warmup, fresh, leaderBy, trendWindow],
  )

  if (session.spins.length <= warmup) {
    return (
      <div className="panel follow-panel">
        <div className="follow-head">
          <span className="panel-title">If you had listened to the leaderboard</span>
          <div className="follow-warmup-group">
            <label className="muted follow-warmup">
              Watch first
              <select value={warmup} onChange={e => setWarmup(Number(e.target.value))}>
                {[...new Set([3, 5, 10, 15, 20, 25, 50, 75, 100, warmup])]
                  .sort((a, b) => a - b)
                  .map(n => (
                    <option key={n} value={n}>{n} spins</option>
                  ))}
              </select>
            </label>
          </div>
        </div>
        <span className="muted">
          Watching the board for the first {warmup} spins without betting. Record{' '}
          {warmup - session.spins.length + 1} more and this will start tracking what following
          the top combo would have done from spin {warmup + 1} onwards.
        </span>
      </div>
    )
  }

  const followBands = bandsForFollowSteps(model.steps, model.ruinedAt)
  const played = model.steps.filter(s => s.bets.length > 0).length
  const beatLockIn = model.profit - model.lockInProfit
  const decided = model.wins + model.losses

  return (
    <div className="panel follow-panel">
      <div className="follow-head">
        <span className="panel-title">If you had listened to the leaderboard</span>
        <div className="follow-warmup-group">
          <label
            className="muted follow-warmup"
            title="Back the biggest total profit, or whatever has gained the most bankroll lately"
          >
            Follow
            <select value={leaderBy} onChange={e => setLeaderBy(e.target.value as LeaderBy)}>
              <option value="profit">top profit</option>
              <option value="trend">hottest trend</option>
            </select>
          </label>
          {leaderBy === 'trend' && (
            <label className="muted follow-warmup" title="How far back the trend is measured at each spin">
              over last
              <select value={trendWindow} onChange={e => setTrendWindow(Number(e.target.value))}>
                {TREND_WINDOWS.map(n => (
                  <option key={n} value={n}>{n} spins</option>
                ))}
              </select>
            </label>
          )}
          <label className="muted follow-warmup" title="Spins to let the board settle before betting a penny">
            Watch first
            <select value={warmup} onChange={e => setWarmup(Number(e.target.value))}>
              {/* The pinned value may not be one of the presets, so it is
                  folded into the list rather than silently lost. */}
              {[...new Set([3, 5, 10, 15, 20, 25, 50, 75, 100, warmup])]
                .sort((a, b) => a - b)
                .map(n => (
                  <option key={n} value={n}>{n} spins</option>
                ))}
            </select>
          </label>
          <button
            className="btn btn-small"
            onClick={() => setWarmup(session.spins.length)}
            disabled={warmup === session.spins.length}
            title="Ignore everything so far and only follow the board from the next spin onwards"
          >
            Start here (spin {session.spins.length})
          </button>
        </div>
      </div>

      <label
        className="follow-mode"
        title={
          fresh
            ? 'You place the leader’s pattern but run the progression yourself: it opens at one unit and restarts whenever the lead changes.'
            : 'You place the board’s exact stakes — which means stepping onto a progression already in motion, at whatever step it has reached.'
        }
      >
        <input type="checkbox" checked={fresh} onChange={e => setFresh(e.target.checked)} />
        <span>
          Start each progression fresh
          <span className="muted">
            {fresh
              ? ` — opening at ${money(session.config.baseUnit)} and restarting on every switch`
              : ' — currently copying the board’s exact stakes, mid-progression and all'}
          </span>
        </span>
      </label>

      {/* Going broke, or being repeatedly priced out, changes what every number
          below means — so it is stated up front rather than buried in details. */}
      {model.ruinedAt !== null && (
        <div className="follow-status broke">
          💀 Lost the bankroll on spin {model.ruinedAt} — sat out the remaining{' '}
          {model.steps.length - model.ruinedAt} spin
          {model.steps.length - model.ruinedAt === 1 ? '' : 's'}
        </div>
      )}
      {model.ruinedAt === null && model.skippedBets > 0 && (
        <div className="follow-status skipped">
          ⚠ Could not afford {model.skippedBets} bet{model.skippedBets === 1 ? '' : 's'} — biggest
          ask was {money(model.biggestSkip)}. Those were skipped, not played.
        </div>
      )}

      <div className="follow-cards">
        <Card
          label={
            model.ruinedAt !== null
              ? `Broke at spin ${model.ruinedAt}`
              : leaderBy === 'trend'
                ? `Followed the hottest (${trendWindow})`
                : 'Followed the board'
          }
          hint={`${model.switches} switch${model.switches === 1 ? '' : 'es'} · ${model.distinctFollowed} combo${model.distinctFollowed === 1 ? '' : 's'} · ${model.wins}W-${model.losses}L${decided > 0 ? ` · ${((model.wins / decided) * 100).toFixed(0)}%` : ''}${model.skippedBets > 0 ? ` · ${model.skippedBets} unaffordable` : ''}`}
          value={model.profit}
          tone
          primary
        />
        <Card
          label={`Committed at spin ${warmup}`}
          hint={
            model.lockInName
              ? `${model.lockInName} — picked by ${leaderBy === 'trend' ? 'trend' : 'profit'}, then never changed`
              : 'no leader yet'
          }
          value={model.lockInProfit}
          tone
        />
        <Card
          label="Best in hindsight"
          hint={`${model.bestHindsightName} — nobody could have known to pick this`}
          value={model.bestHindsightProfit}
        />
        <Card
          label="Average combo"
          hint={`The mean of all ${results.length} combos on the board`}
          value={model.averageProfit}
        />
      </div>

      <button
        className="link follow-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {open ? 'Hide' : 'Show'} details
        <span className="muted">
          {' '}· {played} bet{played === 1 ? '' : 's'} over {model.steps.length} spins
        </span>
      </button>

      {open && (
        <>
          {model.bankrollSeries.length > 1 && (
            <div className="follow-spark">
              <Sparkline
                series={model.bankrollSeries}
                baseline={session.config.startingBankroll}
                width={320}
                bands={followBands}
              />
              <BandLegend bands={followBands} />
            </div>
          )}

          <div className={`follow-verdict ${beatLockIn >= 0 ? 'good' : ''}`}>
            {model.switches === 0 ? (
              <>
                The {leaderBy === 'trend' ? 'hottest combo' : 'lead'} never changed after the
                warm-up, so chasing it was the same as committing to it.
              </>
            ) : beatLockIn >= 0 ? (
              <>
                Chasing the lead beat committing to it by <strong>{money(Math.abs(beatLockIn))}</strong>{' '}
                across {model.switches} switch{model.switches === 1 ? '' : 'es'} — on this one session.
              </>
            ) : (
              <>
                Chasing the lead cost <strong>{money(Math.abs(beatLockIn))}</strong> against simply
                committing to the spin-{warmup} leader. Each switch buys a combo after its good run,
                and past spins do not tell the wheel what to do next.
              </>
            )}
          </div>

          <div className="table-scroll follow-log">
          <table>
            <thead>
              <tr>
                <th>Spin</th>
                <th>Hit</th>
                <th>Followed</th>
                <th className="num">Staked</th>
                <th className="num">Result</th>
                <th className="num">Bankroll</th>
              </tr>
            </thead>
            <tbody>
              {model.steps.map(s => (
                <tr key={s.index} className={s.switched ? 'follow-switch' : ''}>
                  <td>{s.index + 1}</td>
                  <td>{s.n === 37 ? '00' : s.n}</td>
                  <td>
                    {s.followedName ?? <span className="muted">—</span>}
                    {s.switched && <span className="follow-switch-tag"> ⇄ switched</span>}
                    {s.note && <div className="muted follow-note">{s.note}</div>}
                  </td>
                  <td className="num">{s.staked ? money(s.staked) : '—'}</td>
                  <td className={`num ${s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : ''}`}>
                    {s.bets.length === 0 ? '—' : `${s.net >= 0 ? '+' : ''}${money(s.net)}`}
                  </td>
                  <td className="num">{money(s.bankroll)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}
