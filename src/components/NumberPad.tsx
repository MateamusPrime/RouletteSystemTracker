import { useState } from 'react'
import { DOUBLE_ZERO, colorOf, labelOf } from '../domain/roulette'
import type { WheelType } from '../domain/types'

interface Props {
  wheelType: WheelType
  onSpin(n: number): void
}

/**
 * Typing beats hunting for a button at a live table: enter a number and press
 * Enter (or type "00"). Invalid entries are rejected rather than guessed at.
 */
function QuickEntry({ wheelType, onSpin }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const raw = text.trim()
    if (raw === '') return
    if (raw === '00') {
      if (wheelType !== 'american') {
        setError('this wheel has no 00')
        return
      }
      onSpin(DOUBLE_ZERO)
      setText('')
      setError(null)
      return
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > 36) {
      setError(wheelType === 'american' ? 'enter 0-36 or 00' : 'enter 0-36')
      return
    }
    onSpin(n)
    setText('')
    setError(null)
  }

  return (
    <div className="quick-entry">
      <input
        className={error ? 'invalid' : ''}
        value={text}
        placeholder={wheelType === 'american' ? 'Type 0-36 or 00, then Enter' : 'Type 0-36, then Enter'}
        inputMode="numeric"
        aria-label="quick spin entry"
        onChange={e => {
          setText(e.target.value)
          setError(null)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            setText('')
            setError(null)
          }
        }}
      />
      <button className="btn btn-small" onClick={submit} disabled={text.trim() === ''}>
        Add
      </button>
      {error && <span className="neg quick-entry-error">{error}</span>}
    </div>
  )
}

// Classic felt layout: 3 rows of 12, top row = 3..36, bottom row = 1..34.
const ROWS = [3, 2, 1].map(start =>
  Array.from({ length: 12 }, (_, i) => start + i * 3),
)

export function NumberPad({ wheelType, onSpin }: Props) {
  return (
    <>
    <QuickEntry wheelType={wheelType} onSpin={onSpin} />
    <div className="numberpad">
      <div className="numberpad-zeros">
        <button
          className="pocket green"
          onClick={() => onSpin(0)}
          aria-label="record 0"
        >
          0
        </button>
        {wheelType === 'american' && (
          <button
            className="pocket green"
            onClick={() => onSpin(DOUBLE_ZERO)}
            aria-label="record 00"
          >
            00
          </button>
        )}
      </div>
      <div className="numberpad-grid">
        {ROWS.map((row, r) => (
          <div className="numberpad-row" key={r}>
            {row.map(n => (
              <button
                key={n}
                className={`pocket ${colorOf(n)}`}
                onClick={() => onSpin(n)}
                aria-label={`record ${labelOf(n)}`}
              >
                {n}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
    </>
  )
}
