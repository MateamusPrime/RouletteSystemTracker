import type { SessionStats, GroupSplit, NumberFreq } from '../domain/stats'
import { colorOf } from '../domain/roulette'

interface Props {
  stats: SessionStats
}

function Bars({ title, groups }: { title: string; groups: GroupSplit[] }) {
  return (
    <div className="stat-block">
      <div className="stat-title">{title}</div>
      {groups.map(g => (
        <div className="bar-row" key={g.label}>
          <span className="bar-label">{g.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.min(g.pct, 100)}%` }} />
          </div>
          <span className="bar-value">
            {g.count} <span className="muted">({g.pct.toFixed(0)}%)</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function NumberChips({
  title,
  items,
  showGap,
  expected,
}: {
  title: string
  items: NumberFreq[]
  showGap?: boolean
  /** Hits each pocket "should" have by now — makes ahead/behind readable. */
  expected?: number
}) {
  return (
    <div className="stat-block">
      <div className="stat-title">
        {title}
        {expected !== undefined && (
          <span className="muted"> · {expected.toFixed(1)} expected each</span>
        )}
      </div>
      <div className="chip-row">
        {items.map(f => {
          const diff = expected === undefined ? null : f.count - expected
          return (
            <span
              key={f.n}
              className={`chip ${colorOf(f.n)}`}
              title={
                showGap
                  ? f.gap === Infinity
                    ? 'never hit'
                    : `${f.gap} spins ago`
                  : diff === null
                    ? `${f.count} hits`
                    : `${f.count} hits — ${diff >= 0 ? 'ahead of' : 'behind'} the ${expected!.toFixed(1)} expected by ${Math.abs(diff).toFixed(1)}`
              }
            >
              {f.label}
              <small>{showGap ? (f.gap === Infinity ? '∞' : f.gap) : f.count}</small>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function StatsPanel({ stats }: Props) {
  return (
    <div className="stats-panel">
      <div className="panel-title">Session Stats</div>
      {stats.total === 0 ? (
        <span className="muted">Stats appear once spins are recorded.</span>
      ) : (
        <>
          <Bars title="Colors" groups={stats.colors} />
          <Bars title="Odd / Even" groups={stats.oddEven} />
          <Bars title="Low / High" groups={stats.highLow} />
          <Bars title="Dozens" groups={stats.dozens} />
          <Bars title="Columns" groups={stats.columns} />
          <NumberChips
            title="Hot numbers"
            items={stats.hot}
            expected={stats.chi.expectedPerPocket}
          />
          <NumberChips
            title="Cold numbers"
            items={stats.cold}
            expected={stats.chi.expectedPerPocket}
          />
          <NumberChips title="Sleepers (spins since hit)" items={stats.sleepers} showGap />
          <div className="stat-block">
            <div className="stat-title">Advanced</div>
            <div className="kv">
              <span className="muted">Current color streak</span>
              <span>
                {stats.currentColorStreak.length > 0
                  ? `${stats.currentColorStreak.color} × ${stats.currentColorStreak.length}`
                  : '-'}
              </span>
            </div>
            <div className="kv">
              <span className="muted">Longest color streak</span>
              <span>
                {stats.longestColorStreak.length > 0
                  ? `${stats.longestColorStreak.color} × ${stats.longestColorStreak.length}`
                  : '-'}
              </span>
            </div>
            <div className="kv">
              <span className="muted">Zeros hit</span>
              <span>{stats.zeros}</span>
            </div>
            <div className="kv">
              <span className="muted">Back-to-back repeats</span>
              <span>{stats.repeatCount}</span>
            </div>
            <div className="kv" title={stats.chi.detail}>
              <span className="muted">Evenness (χ²)</span>
              <span>
                {stats.chiSquared.toFixed(1)}{' '}
                <span className="muted">/ {stats.chi.df} expected</span>
              </span>
            </div>
            <div
              className={`chi-verdict ${
                !stats.chi.reliable ? 'unknown' : stats.chi.z >= 2.5 ? 'flag' : 'ok'
              }`}
              title={stats.chi.detail}
            >
              {stats.chi.reliable
                ? `${stats.chi.z >= 0 ? '+' : ''}${stats.chi.z.toFixed(1)}σ — ${stats.chi.verdict}`
                : stats.chi.verdict}
            </div>
          </div>
          <Bars title="Wheel sectors (physical quarters)" groups={stats.sectors} />
        </>
      )}
    </div>
  )
}
