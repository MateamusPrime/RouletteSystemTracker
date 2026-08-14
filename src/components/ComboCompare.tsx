import { assessCombo, formatMoney } from '../domain/confidence'
import type { ComboResult } from '../domain/simulation'
import type { WheelType } from '../domain/types'
import { Sparkline } from './Sparkline'

interface Props {
  a: ComboResult | null
  b: ComboResult | null
  startingBankroll: number
  wheelType: WheelType
  onClear(): void
}

interface Row {
  label: string
  value(c: ComboResult): string
  /** Which side is better; omitted when the metric has no winner. */
  better?(a: ComboResult, b: ComboResult): 'a' | 'b' | 'tie'
}

const higher = (pick: (c: ComboResult) => number) => (a: ComboResult, b: ComboResult) =>
  pick(a) === pick(b) ? 'tie' : pick(a) > pick(b) ? 'a' : ('b' as const)
const lower = (pick: (c: ComboResult) => number) => (a: ComboResult, b: ComboResult) =>
  pick(a) === pick(b) ? 'tie' : pick(a) < pick(b) ? 'a' : ('b' as const)

const winRate = (c: ComboResult) => c.wins / Math.max(1, c.wins + c.losses)

const ROWS: Row[] = [
  { label: 'Profit', value: c => formatMoney(c.profit), better: higher(c => c.profit) },
  {
    label: 'Win rate',
    value: c => `${(winRate(c) * 100).toFixed(0)}%`,
    better: higher(winRate),
  },
  { label: 'Record', value: c => `${c.wins}W-${c.losses}L` },
  {
    label: 'Max drawdown',
    value: c => formatMoney(c.maxDrawdown),
    better: lower(c => c.maxDrawdown),
  },
  { label: 'Total staked', value: c => formatMoney(c.totalStaked) },
  {
    label: 'Peak single stake',
    value: c => formatMoney(c.peakStake),
    better: lower(c => c.peakStake),
  },
  { label: 'Spins sat out', value: c => String(c.sitOuts) },
  {
    label: 'Table-limit breaches',
    value: c => String(c.limitBreaches),
    better: lower(c => c.limitBreaches),
  },
  {
    label: 'Ran out of money',
    value: c => (c.ruinedAt === null ? 'no' : `spin ${c.ruinedAt}`),
    better: lower(c => (c.ruinedAt === null ? 0 : 1)),
  },
]

/**
 * Two combos side by side. Close contenders on the leaderboard usually differ
 * in ways profit alone hides — drawdown, peak stake, whether they could even
 * be played — so every metric marks which side came out better.
 */
export function ComboCompare({ a, b, startingBankroll, wheelType, onClear }: Props) {
  if (!a || !b) {
    return (
      <div className="panel">
        <div className="panel-title">Compare</div>
        <span className="muted">
          Select a combo, then click the ◇ in another row to pin it here side by side.
        </span>
      </div>
    )
  }

  const confA = assessCombo(a, wheelType)
  const confB = assessCombo(b, wheelType)
  const name = (c: ComboResult) => `${c.placementName} × ${c.moneyName}`

  return (
    <div className="panel">
      <div className="review-header">
        <span className="panel-title">Compare</span>
        <button className="link" onClick={onClear}>clear comparison</button>
      </div>

      <table className="compare-table">
        <thead>
          <tr>
            <th />
            <th>{name(a)}</th>
            <th>{name(b)}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="compare-charts">
            <td />
            <td>
              <Sparkline series={a.bankrollSeries} baseline={startingBankroll} />
            </td>
            <td>
              <Sparkline series={b.bankrollSeries} baseline={startingBankroll} />
            </td>
          </tr>
          {ROWS.map(row => {
            const winner = row.better?.(a, b)
            return (
              <tr key={row.label}>
                <td className="muted">{row.label}</td>
                <td className={winner === 'a' ? 'compare-win' : ''}>{row.value(a)}</td>
                <td className={winner === 'b' ? 'compare-win' : ''}>{row.value(b)}</td>
              </tr>
            )
          })}
          <tr>
            <td className="muted">Ahead of the maths by</td>
            <td className={confA.luck > confB.luck ? 'compare-win' : ''}>
              {formatMoney(confA.luck)}
            </td>
            <td className={confB.luck > confA.luck ? 'compare-win' : ''}>
              {formatMoney(confB.luck)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="muted hint">
        The gap between these two is {formatMoney(Math.abs(a.profit - b.profit))}, against a
        session swing of about {formatMoney(Math.max(confA.swing, confB.swing))} — if the gap
        is the smaller number, the ordering here is noise.
      </div>
    </div>
  )
}
