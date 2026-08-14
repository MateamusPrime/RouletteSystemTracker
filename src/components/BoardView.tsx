import {
  ALL_BLACK,
  ALL_EVEN,
  ALL_HIGH,
  ALL_LOW,
  ALL_ODD,
  ALL_RED,
  DOUBLE_ZERO,
  NUMBERS_BY_COLUMN,
  NUMBERS_BY_DOZEN,
  colorOf,
  labelOf,
} from '../domain/roulette'
import type { PlacedBet } from '../domain/simulation'

/** Outside boxes we can drop a chip onto, matched by their exact number set. */
const OUTSIDE_BOXES: { key: string; label: string; numbers: number[] }[] = [
  { key: 'red', label: 'RED', numbers: ALL_RED },
  { key: 'black', label: 'BLACK', numbers: ALL_BLACK },
  { key: 'odd', label: 'ODD', numbers: ALL_ODD },
  { key: 'even', label: 'EVEN', numbers: ALL_EVEN },
  { key: 'low', label: '1-18', numbers: ALL_LOW },
  { key: 'high', label: '19-36', numbers: ALL_HIGH },
  { key: 'dozen1', label: '1st 12', numbers: NUMBERS_BY_DOZEN[1] },
  { key: 'dozen2', label: '2nd 12', numbers: NUMBERS_BY_DOZEN[2] },
  { key: 'dozen3', label: '3rd 12', numbers: NUMBERS_BY_DOZEN[3] },
  { key: 'column1', label: 'Col 1', numbers: NUMBERS_BY_COLUMN[1] },
  { key: 'column2', label: 'Col 2', numbers: NUMBERS_BY_COLUMN[2] },
  { key: 'column3', label: 'Col 3', numbers: NUMBERS_BY_COLUMN[3] },
]

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every(n => s.has(n))
}

function money(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}

/**
 * Read-only felt showing where the chips were for one spin: outside bets get a
 * chip on their box, single numbers get a chip on the pocket, and multi-number
 * inside bets highlight their pockets. The winning pocket is ringed.
 */
export function BoardView({ bets, hit }: { bets: PlacedBet[]; hit: number }) {
  const boxChips = new Map<string, number>()
  const pocketChips = new Map<number, number>()
  const covered = new Set<number>()

  for (const b of bets) {
    for (const n of b.numbers) covered.add(n)
    const box = OUTSIDE_BOXES.find(o => sameSet(o.numbers, b.numbers))
    if (box) {
      boxChips.set(box.key, (boxChips.get(box.key) ?? 0) + b.amount)
    } else if (b.numbers.length === 1) {
      const n = b.numbers[0]
      pocketChips.set(n, (pocketChips.get(n) ?? 0) + b.amount)
    }
  }

  const cell = (n: number, style?: React.CSSProperties) => {
    const chip = pocketChips.get(n)
    return (
      <div
        key={n}
        style={style}
        className={`felt-cell ${colorOf(n)} ${covered.has(n) ? 'covered' : ''} ${n === hit ? 'hit' : ''}`}
      >
        {labelOf(n)}
        {chip !== undefined && <span className="felt-chip">{money(chip)}</span>}
      </div>
    )
  }

  const box = (key: string, style: React.CSSProperties, extra = '') => {
    const info = OUTSIDE_BOXES.find(o => o.key === key)!
    const chip = boxChips.get(key)
    return (
      <div
        key={key}
        style={style}
        className={`felt-cell outside ${extra} ${chip !== undefined ? 'picked' : ''}`}
      >
        {info.label}
        {chip !== undefined && <span className="felt-chip">{money(chip)}</span>}
      </div>
    )
  }

  const numbers = []
  for (let c = 1; c <= 12; c++) {
    for (let r = 1; r <= 3; r++) {
      numbers.push(cell(c * 3 - (r - 1), { gridColumn: c + 1, gridRow: r }))
    }
  }

  return (
    <div className="felt-board review-board">
      <div className="felt-zeros">
        {cell(0)}
        {cell(DOUBLE_ZERO)}
      </div>
      {numbers}
      {(['column3', 'column2', 'column1'] as const).map((k, r) =>
        box(k, { gridColumn: 14, gridRow: r + 1 }, 'two-to-one'),
      )}
      {box('dozen1', { gridColumn: '2 / span 4', gridRow: 4 })}
      {box('dozen2', { gridColumn: '6 / span 4', gridRow: 4 })}
      {box('dozen3', { gridColumn: '10 / span 4', gridRow: 4 })}
      {box('low', { gridColumn: '2 / span 2', gridRow: 5 })}
      {box('even', { gridColumn: '4 / span 2', gridRow: 5 })}
      {box('red', { gridColumn: '6 / span 2', gridRow: 5 }, 'red-cell')}
      {box('black', { gridColumn: '8 / span 2', gridRow: 5 }, 'black-cell')}
      {box('odd', { gridColumn: '10 / span 2', gridRow: 5 })}
      {box('high', { gridColumn: '12 / span 2', gridRow: 5 })}
    </div>
  )
}
