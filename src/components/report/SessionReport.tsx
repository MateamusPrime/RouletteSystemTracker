import { useMemo } from 'react'
import { assessCombo, formatMoney, leadIsMeaningful } from '../../domain/confidence'
import { colorOf, labelOf } from '../../domain/roulette'
import type { ComboResult } from '../../domain/simulation'
import { computeStats } from '../../domain/stats'
import type { GroupSplit } from '../../domain/stats'
import type { Session } from '../../domain/types'

interface Props {
  session: Session
  results: ComboResult[]
  onClose(): void
}

const TOP_ROWS = 15

function Split({ title, groups }: { title: string; groups: GroupSplit[] }) {
  return (
    <div className="report-split">
      <h3>{title}</h3>
      <table>
        <tbody>
          {groups.map(g => (
            <tr key={g.label}>
              <td>{g.label}</td>
              <td>{g.count}</td>
              <td>{g.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A shareable record of how a session actually went: the spins, what the wheel
 * did, and which combos would have made money — with the same honesty about
 * sample size that the tracker shows live.
 */
export function SessionReport({ session, results, onClose }: Props) {
  const stats = useMemo(
    () => computeStats(session.spins, session.config.wheelType),
    [session],
  )
  const ranked = useMemo(() => [...results].sort((a, b) => b.profit - a.profit), [results])
  const best = ranked[0] ?? null
  const runnerUp = ranked[1] ?? null
  const verdict = best
    ? leadIsMeaningful(best, runnerUp, results.length, session.config.wheelType)
    : null
  const conf = best ? assessCombo(best, session.config.wheelType) : null
  const generatedOn = useMemo(() => new Date().toLocaleString(), [])
  const cfg = session.config

  return (
    <div className="system-report">
      <div className="report-toolbar no-print">
        <button className="btn" onClick={onClose}>← Back to app</button>
        <span className="muted">
          Tip: in the print dialog, turn OFF "Headers and footers" and keep
          "Background graphics" ON for the cleanest PDF.
        </span>
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <header className="report-header">
        <div className="report-brand">◉ Roulette System Tracker</div>
        <h1>{session.name}</h1>
        <div className="report-subtitle">
          Session report · {session.spins.length} spins ·{' '}
          {cfg.wheelType === 'american' ? 'American (0/00)' : 'European (0)'} wheel ·
          bankroll ${cfg.startingBankroll} · unit ${cfg.baseUnit}
          {(cfg.tableMin || cfg.tableMaxOutside || cfg.tableMaxInside) && (
            <>
              {' '}· table {cfg.tableMin ? `min $${cfg.tableMin}` : 'no min'}
              {cfg.tableMaxOutside ? `, outside max $${cfg.tableMaxOutside}` : ''}
              {cfg.tableMaxInside ? `, inside max $${cfg.tableMaxInside}` : ''}
            </>
          )}
        </div>
      </header>

      <section className="report-step">
        <h2>The spins</h2>
        <div className="report-spins">
          {session.spins.map((s, i) => (
            <span key={i} className={`report-pocket ${colorOf(s.n)}`}>
              {labelOf(s.n)}
            </span>
          ))}
        </div>
        <p className="muted">Read left to right, oldest first.</p>
      </section>

      <section className="report-step">
        <h2>What the wheel did</h2>
        <div className="report-splits">
          <Split title="Colors" groups={stats.colors} />
          <Split title="Odd / Even" groups={stats.oddEven} />
          <Split title="Low / High" groups={stats.highLow} />
          <Split title="Dozens" groups={stats.dozens} />
          <Split title="Columns" groups={stats.columns} />
        </div>
        <table>
          <tbody>
            <tr>
              <td>Hottest numbers</td>
              <td>{stats.hot.map(h => `${h.label} (${h.count})`).join(', ') || '—'}</td>
            </tr>
            <tr>
              <td>Longest color streak</td>
              <td>
                {stats.longestColorStreak.length > 0
                  ? `${stats.longestColorStreak.color} × ${stats.longestColorStreak.length}`
                  : '—'}
              </td>
            </tr>
            <tr>
              <td>Back-to-back repeats</td>
              <td>{stats.repeatCount}</td>
            </tr>
            <tr>
              <td>Zeros</td>
              <td>{stats.zeros}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {best && conf && verdict && (
        <section className="report-step">
          <h2>Best combo</h2>
          <p>
            <strong>{best.placementName} × {best.moneyName}</strong> finished{' '}
            <strong>{formatMoney(best.profit)}</strong> over {session.spins.length} spins
            ({best.wins}W-{best.losses}L), with a maximum drawdown of{' '}
            {formatMoney(best.maxDrawdown)} and a peak stake of {formatMoney(best.peakStake)}.
          </p>
          <p className={verdict.meaningful ? '' : 'report-warning'}>
            <strong>{verdict.meaningful ? 'Lead stands out:' : 'Not meaningful yet:'}</strong>{' '}
            {verdict.reason}. At the house edge this combo was expected to be down{' '}
            {formatMoney(-conf.expectedProfit)} on {formatMoney(best.totalStaked)} staked, so it
            ran {formatMoney(Math.abs(conf.luck))} {conf.luck >= 0 ? 'ahead of' : 'behind'} the
            maths — about {Math.abs(conf.z).toFixed(1)} standard deviations against a session
            swing of {formatMoney(conf.swing)}. {results.length} combos were compared, and the
            best of that many will look good by chance alone.
          </p>
        </section>
      )}

      <section className="report-step">
        <h2>Leaderboard — top {Math.min(TOP_ROWS, ranked.length)}</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Placement</th>
              <th>Money management</th>
              <th>Profit</th>
              <th>W-L</th>
              <th>Max DD</th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, TOP_ROWS).map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {r.placementName}
                  {r.ruinedAt !== null && <strong> (out on spin {r.ruinedAt})</strong>}
                </td>
                <td>{r.moneyName}</td>
                <td>{formatMoney(r.profit)}</td>
                <td>{r.wins}-{r.losses}</td>
                <td>{formatMoney(r.maxDrawdown)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="report-footer">
        Generated {generatedOn} · Roulette System Tracker · Roulette outcomes are
        independent; no system changes the house edge. Play responsibly.
      </footer>
    </div>
  )
}
