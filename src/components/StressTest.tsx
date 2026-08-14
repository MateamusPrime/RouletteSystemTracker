import { useMemo, useState } from 'react'
import type { MoneyManagementSystem } from '../domain/money'
import { histogram, runMonteCarlo } from '../domain/monteCarlo'
import type { MonteCarloResult } from '../domain/monteCarlo'
import type { PlacementSystem } from '../domain/placement'
import type { ComboResult } from '../domain/simulation'
import type { Session } from '../domain/types'

interface Props {
  placements: PlacementSystem[]
  moneys: MoneyManagementSystem<any>[]
  session: Session
  /** Leaderboard order, so the top performers can be batch-tested. */
  leaderboard: ComboResult[]
}

interface FieldRow {
  label: string
  combo: ComboResult
  result: MonteCarloResult
}

function money(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

/** Bar chart of the profit distribution, with break-even marked. */
function Histogram({ result }: { result: MonteCarloResult }) {
  const bins = useMemo(() => histogram(result.profits, 28), [result])
  if (bins.length === 0) return null
  const max = Math.max(...bins.map(b => b.count))
  const width = 560
  const height = 130
  const barW = width / bins.length
  const min = bins[0].x
  const span = bins[bins.length - 1].x - min || 1
  const zeroX = ((0 - min) / span) * width

  return (
    <svg className="mc-histogram" viewBox={`0 0 ${width} ${height + 18}`} width="100%">
      {bins.map((b, i) => {
        const h = (b.count / max) * height
        return (
          <rect
            key={i}
            x={i * barW + 1}
            y={height - h}
            width={Math.max(barW - 2, 1)}
            height={h}
            fill={b.x >= 0 ? 'var(--win)' : 'var(--loss)'}
            opacity={0.85}
          />
        )
      })}
      {zeroX >= 0 && zeroX <= width && (
        <>
          <line x1={zeroX} x2={zeroX} y1={0} y2={height} stroke="var(--accent)" strokeDasharray="4 3" />
          <text x={zeroX + 4} y={11} fill="var(--accent)" fontSize="9">
            break even
          </text>
        </>
      )}
      <text x={2} y={height + 13} fill="currentColor" fontSize="9" opacity={0.7}>
        {money(bins[0].x)}
      </text>
      <text x={width - 2} y={height + 13} fill="currentColor" fontSize="9" opacity={0.7} textAnchor="end">
        {money(bins[bins.length - 1].x)}
      </text>
    </svg>
  )
}

export function StressTest({ placements, moneys, session, leaderboard }: Props) {
  const [placementId, setPlacementId] = useState(placements[0]?.id ?? '')
  const [moneyId, setMoneyId] = useState(moneys[0]?.id ?? '')
  const [runs, setRuns] = useState(300)
  const [spinsPerRun, setSpinsPerRun] = useState(200)
  const [seed, setSeed] = useState(1)
  const [bankroll, setBankroll] = useState(session.config.startingBankroll)
  const [baseUnit, setBaseUnit] = useState(session.config.baseUnit)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<MonteCarloResult | null>(null)
  const [ranWith, setRanWith] = useState<string>('')
  const [field, setField] = useState<FieldRow[] | null>(null)
  const [topN, setTopN] = useState(5)

  const placement = placements.find(p => p.id === placementId)
  const moneySystem = moneys.find(m => m.id === moneyId)
  const totalSpins = runs * spinsPerRun

  /**
   * Batch-tests the leaderboard's leaders. A session winner is usually just
   * the luckiest of many; running them all over the same fair spins shows
   * which (if any) actually behaves differently.
   */
  const runField = async () => {
    const picks = leaderboard.slice(0, topN)
    if (picks.length === 0) return
    setRunning(true)
    setProgress(0)
    setResult(null)
    setField(null)
    await new Promise(r => setTimeout(r, 0))
    const rows: FieldRow[] = []
    for (const [i, combo] of picks.entries()) {
      const p = placements.find(x => x.id === combo.placementId)
      const m = moneys.find(x => x.id === combo.moneyId)
      if (!p || !m) continue
      const res = await runMonteCarlo(
        p,
        m,
        {
          runs,
          spinsPerRun,
          seed, // the same spins for every contender, so it is a fair race
          config: { ...session.config, startingBankroll: bankroll, baseUnit },
        },
        done => setProgress((i + done / runs) / picks.length),
      )
      rows.push({ label: `${combo.placementName} × ${combo.moneyName}`, combo, result: res })
    }
    setField(rows)
    setRanWith(`Top ${rows.length} · ${runs} runs × ${spinsPerRun} spins · seed ${seed}`)
    setRunning(false)
  }

  const run = async () => {
    if (!placement || !moneySystem) return
    setRunning(true)
    setProgress(0)
    setResult(null)
    setField(null)
    // Let the button repaint as disabled before the batch starts.
    await new Promise(r => setTimeout(r, 0))
    const res = await runMonteCarlo(
      placement,
      moneySystem,
      {
        runs,
        spinsPerRun,
        seed,
        config: { ...session.config, startingBankroll: bankroll, baseUnit },
      },
      done => setProgress(done / runs),
    )
    setResult(res)
    setRanWith(
      `${placement.name} × ${moneySystem.name} · ${runs} runs × ${spinsPerRun} spins · seed ${seed}`,
    )
    setRunning(false)
  }

  return (
    <div className="builder-page">
      <div className="panel">
        <div className="panel-title">Stress Test</div>
        <p className="muted">
          A live session of twenty spins tells you almost nothing. This plays a combo
          over thousands of fair, independent spins so you can see the shape of it —
          how wide the outcomes spread, how often it busts, and how it compares with
          what the house edge alone predicts. Same seed, same batch, every time — so
          re-run on a few different seeds before believing any result.
        </p>

        <div className="field-row">
          <label className="field grow">
            Placement system
            <select value={placementId} onChange={e => setPlacementId(e.target.value)}>
              {placements.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="field grow">
            Money management
            <select value={moneyId} onChange={e => setMoneyId(e.target.value)}>
              {moneys.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            Runs
            <input
              type="number"
              min={10}
              max={5000}
              step={50}
              value={runs}
              onChange={e => setRuns(Math.max(10, Math.min(5000, Number(e.target.value) || 10)))}
            />
          </label>
          <label className="field">
            Spins per run
            <input
              type="number"
              min={10}
              max={2000}
              step={50}
              value={spinsPerRun}
              onChange={e => setSpinsPerRun(Math.max(10, Math.min(2000, Number(e.target.value) || 10)))}
            />
          </label>
          <label
            className="field"
            title="Picks WHICH stream of random spins the batch is carved out of. Every run still gets its own different spins — the seed fixes the whole batch, not each run. Any number works and none is better than another; the same seed replays the identical batch, so results are reproducible. Change it for a completely fresh batch."
          >
            Seed
            <div className="seed-field">
              <input
                type="number"
                min={1}
                value={seed}
                onChange={e => setSeed(Math.max(1, Number(e.target.value) || 1))}
              />
              <button
                type="button"
                className="btn btn-small"
                title="Draw a fresh batch of spins. If a result holds up across several seeds it is the system; if it moves a lot, it was the batch."
                onClick={() => setSeed(Math.floor(Math.random() * 1_000_000) + 1)}
              >
                🎲 New batch
              </button>
            </div>
          </label>
          <label className="field">
            Bankroll $
            <input
              type="number"
              min={1}
              value={bankroll}
              onChange={e => setBankroll(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="field">
            Unit $
            <input
              type="number"
              min={1}
              value={baseUnit}
              onChange={e => setBaseUnit(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>

        <div className="builder-actions">
          <button className="btn btn-primary" onClick={run} disabled={running || !placement}>
            {running ? `Running… ${Math.round(progress * 100)}%` : 'Run stress test'}
          </button>
          <button
            className="btn"
            onClick={runField}
            disabled={running || leaderboard.length === 0}
            title="Race the leaderboard's leaders over the same simulated spins"
          >
            Test top {topN} from the leaderboard
          </button>
          <label className="field">
            Top N
            <input
              type="number"
              min={2}
              max={12}
              value={topN}
              onChange={e => setTopN(Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
            />
          </label>
          <span className="muted">
            {totalSpins.toLocaleString()} simulated spins
            {totalSpins > 200_000 && ' — this will take a while'}
          </span>
        </div>
        {running && (
          <div className="mc-progress">
            <div className="mc-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {field && field.length > 0 && (
        <div className="panel">
          <div className="panel-title">The field, over the same spins</div>
          <div className="muted mc-ran-with">{ranWith}</div>
          <div className="table-scroll">
            <table className="mc-field">
              <thead>
                <tr>
                  <th>Combo</th>
                  <th className="num">This session</th>
                  <th className="num">Median run</th>
                  <th className="num">Mean run</th>
                  <th className="num">In profit</th>
                  <th className="num">Out of money</th>
                  <th className="num">Worst</th>
                </tr>
              </thead>
              <tbody>
                {field.map((row, i) => (
                  <tr key={i}>
                    <td>{row.label}</td>
                    <td className={`num ${row.combo.profit >= 0 ? 'pos' : 'neg'}`}>
                      {money(row.combo.profit)}
                    </td>
                    <td className={`num ${row.result.median >= 0 ? 'pos' : 'neg'}`}>
                      {money(row.result.median)}
                    </td>
                    <td className={`num ${row.result.mean >= 0 ? 'pos' : 'neg'}`}>
                      {money(row.result.mean)}
                    </td>
                    <td className="num">{pct(row.result.winRate)}</td>
                    <td className={`num ${row.result.ruinRate > 0 ? 'neg' : ''}`}>
                      {pct(row.result.ruinRate)}
                    </td>
                    <td className="num neg">{money(row.result.worst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted hint">
            "This session" is what won your leaderboard; the rest is how each combo
            behaves over {(runs * spinsPerRun).toLocaleString()} fresh spins. If the
            session leader is unremarkable here, it led on luck rather than design.
          </div>
        </div>
      )}

      {result && (
        <div className="panel">
          <div className="panel-title">Results</div>
          <div className="muted mc-ran-with">{ranWith}</div>

          <div className="mc-headline">
            <div>
              <span className="muted">Median run</span>
              <strong className={result.median >= 0 ? 'pos' : 'neg'}>{money(result.median)}</strong>
            </div>
            <div>
              <span className="muted">Mean run</span>
              <strong className={result.mean >= 0 ? 'pos' : 'neg'}>{money(result.mean)}</strong>
            </div>
            <div>
              <span className="muted">Runs in profit</span>
              <strong>{pct(result.winRate)}</strong>
            </div>
            <div>
              <span className="muted">Ran out of money</span>
              <strong className={result.ruinRate > 0 ? 'neg' : ''}>{pct(result.ruinRate)}</strong>
            </div>
          </div>

          <Histogram result={result} />

          <table className="mc-table">
            <tbody>
              <tr>
                <td>Worst / best run</td>
                <td>
                  <span className="neg">{money(result.worst)}</span> …{' '}
                  <span className="pos">{money(result.best)}</span>
                </td>
              </tr>
              <tr>
                <td>Middle half of runs (25th–75th)</td>
                <td>{money(result.p25)} … {money(result.p75)}</td>
              </tr>
              <tr>
                <td>5th–95th percentile</td>
                <td>{money(result.p5)} … {money(result.p95)}</td>
              </tr>
              <tr>
                <td>Average staked per run</td>
                <td>{money(result.meanStaked)}</td>
              </tr>
              <tr>
                <td>Average max drawdown</td>
                <td>{money(result.meanMaxDrawdown)}</td>
              </tr>
              <tr>
                <td>Runs that broke a table limit</td>
                <td>{pct(result.limitRate)}</td>
              </tr>
              <tr>
                <td>Runs whose bankroll hit zero</td>
                <td>{pct(result.bustRate)}</td>
              </tr>
              <tr className="mc-expected">
                <td>Expected by the house edge alone</td>
                <td>{money(result.expectedProfit)}</td>
              </tr>
            </tbody>
          </table>

          <div className="muted hint">
            The mean run should land near the house-edge expectation — that is the maths
            working, not the system failing. What a staking plan really changes is the{' '}
            <em>shape</em>: how often you win a little versus lose a lot. A high
            "runs in profit" paired with a brutal worst case is the classic
            progression trade, not an edge.
          </div>
        </div>
      )}
    </div>
  )
}
