import { FIXED_BET_INFO, comboLabel } from '../../domain/custom/stepInterpreter'
import type { FixedBetKind, StepBetDef } from '../../domain/custom/types'
import { DOUBLE_ZERO, colorOf } from '../../domain/roulette'

interface Props {
  bets: StepBetDef[]
  onToggleOutside(kind: FixedBetKind): void
  onToggleNumber(n: number): void
  onToggleCombo(numbers: number[]): void
  /** Renders a chip's amount; lets the builder show units or dollars. */
  formatAmount?(units: number): string
}

function fmtUnits(u: number): string {
  return String(parseFloat(u.toFixed(2)))
}

type SpotPos = 'right' | 'bottom' | 'corner'

interface Spot {
  numbers: number[]
  pos: SpotPos
}

/** The inside-bet hotspots that belong to the cell holding number `n` at (col, row). */
function cellSpots(c: number, r: number, n: number): Spot[] {
  const spots: Spot[] = []
  if (c < 12) spots.push({ numbers: [n, n + 3], pos: 'right' })
  if (r < 3) spots.push({ numbers: [n - 1, n], pos: 'bottom' })
  if (c < 12 && r < 3) spots.push({ numbers: [n - 1, n, n + 2, n + 3], pos: 'corner' })
  if (r === 3) spots.push({ numbers: [n, n + 1, n + 2], pos: 'bottom' })
  if (r === 3 && c < 12) spots.push({ numbers: [n, n + 1, n + 2, n + 3, n + 4, n + 5], pos: 'corner' })
  return spots
}

/**
 * A clickable felt laid out like a real roulette table: zeros on the left,
 * the 3×12 number grid (top row 3-36, bottom row 1-34), 2-to-1 column bets at
 * the end of each row, dozens beneath, even-money bets along the bottom.
 *
 * Inside bets are placed exactly like on a physical table: click the line
 * between two numbers for a split, the intersection of four for a corner, the
 * bottom edge of a column for a street, and the junction of two streets for a
 * six line. Placed bets show a chip with their units.
 */
export function BoardEditor({
  bets,
  onToggleOutside,
  onToggleNumber,
  onToggleCombo,
  formatAmount = fmtUnits,
}: Props) {
  const fixedBet = (kind: FixedBetKind) =>
    bets.find(b => b.target.kind === 'fixed' && b.target.bet === kind)
  const numbersGroup = bets.find(b => b.target.kind === 'numbers')
  const pickedNumbers =
    numbersGroup?.target.kind === 'numbers' ? new Set(numbersGroup.target.numbers) : new Set<number>()
  const comboBet = (numbers: number[]) =>
    bets.find(
      b => b.target.kind === 'combo' && b.target.numbers.join('-') === numbers.join('-'),
    )

  const chip = (units: number) => <span className="felt-chip">{formatAmount(units)}</span>

  const outsideCell = (
    kind: FixedBetKind,
    style: React.CSSProperties,
    extraClass = '',
    label?: string,
  ) => {
    const bet = fixedBet(kind)
    return (
      <button
        key={kind}
        type="button"
        style={style}
        title={FIXED_BET_INFO[kind].label}
        className={`felt-cell outside ${extraClass} ${bet ? 'picked' : ''}`}
        onClick={() => onToggleOutside(kind)}
      >
        {label ?? FIXED_BET_INFO[kind].label}
        {bet && chip(bet.units)}
      </button>
    )
  }

  const zeroCell = (n: number) => {
    const picked = pickedNumbers.has(n)
    return (
      <button
        key={n}
        type="button"
        className={`felt-cell ${colorOf(n)} ${picked ? 'picked' : ''}`}
        onClick={() => onToggleNumber(n)}
      >
        {n === DOUBLE_ZERO ? '00' : n}
        {picked && numbersGroup && chip(numbersGroup.units)}
      </button>
    )
  }

  const numberCellWrap = (c: number, r: number) => {
    const n = c * 3 - (r - 1)
    const picked = pickedNumbers.has(n)
    return (
      <div key={n} className="felt-cell-wrap" style={{ gridColumn: c + 1, gridRow: r }}>
        <button
          type="button"
          className={`felt-cell ${colorOf(n)} ${picked ? 'picked' : ''}`}
          onClick={() => onToggleNumber(n)}
        >
          {n}
          {picked && numbersGroup && chip(numbersGroup.units)}
        </button>
        {cellSpots(c, r, n).map(spot => {
          const bet = comboBet(spot.numbers)
          const label = comboLabel(spot.numbers)
          return (
            <button
              key={label}
              type="button"
              title={label}
              className={`felt-spot ${spot.pos} ${bet ? 'placed' : ''}`}
              onClick={() => onToggleCombo(spot.numbers)}
            >
              {bet ? formatAmount(bet.units) : ''}
            </button>
          )
        })}
      </div>
    )
  }

  const numberCells = []
  for (let c = 1; c <= 12; c++) {
    for (let r = 1; r <= 3; r++) {
      numberCells.push(numberCellWrap(c, r))
    }
  }

  const COLUMN_BY_ROW: FixedBetKind[] = ['column3', 'column2', 'column1']

  return (
    <div className="felt-board">
      <div className="felt-zeros">
        {zeroCell(0)}
        {zeroCell(DOUBLE_ZERO)}
      </div>
      {numberCells}
      {COLUMN_BY_ROW.map((kind, r) =>
        outsideCell(kind, { gridColumn: 14, gridRow: r + 1 }, 'two-to-one', '2 to 1'),
      )}
      {outsideCell('dozen1', { gridColumn: '2 / span 4', gridRow: 4 }, '', '1st 12')}
      {outsideCell('dozen2', { gridColumn: '6 / span 4', gridRow: 4 }, '', '2nd 12')}
      {outsideCell('dozen3', { gridColumn: '10 / span 4', gridRow: 4 }, '', '3rd 12')}
      {outsideCell('low', { gridColumn: '2 / span 2', gridRow: 5 })}
      {outsideCell('even', { gridColumn: '4 / span 2', gridRow: 5 })}
      {outsideCell('red', { gridColumn: '6 / span 2', gridRow: 5 }, 'red-cell')}
      {outsideCell('black', { gridColumn: '8 / span 2', gridRow: 5 }, 'black-cell')}
      {outsideCell('odd', { gridColumn: '10 / span 2', gridRow: 5 })}
      {outsideCell('high', { gridColumn: '12 / span 2', gridRow: 5 })}
    </div>
  )
}
