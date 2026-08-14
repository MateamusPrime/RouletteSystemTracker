import { useEffect, useRef, useState } from 'react'
import { DOUBLE_ZERO, colorOf, labelOf } from '../domain/roulette'
import type { Spin, WheelType } from '../domain/types'

interface Props {
  spins: Spin[]
  wheelType: WheelType
  onUndo(): void
  onEdit(index: number, n: number): void
  onDelete(index: number): void
}

/** Parses a typed pocket, or null if it is not valid for this wheel. */
function parsePocket(raw: string, wheelType: WheelType): number | null {
  const text = raw.trim()
  if (text === '00') return wheelType === 'american' ? DOUBLE_ZERO : null
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0 || n > 36) return null
  return n
}

export function HistoryStrip({ spins, wheelType, onUndo, onEdit, onDelete }: Props) {
  // Index into the real spins array, not the reversed view shown on screen.
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing !== null) inputRef.current?.select()
  }, [editing])

  // Newest first, so the spin that just landed reads top-left.
  const recent = spins
    .map((spin, index) => ({ spin, index }))
    .slice(-40)
    .reverse()

  const commit = () => {
    if (editing === null) return
    const n = parsePocket(draft, wheelType)
    if (n !== null && n !== spins[editing]?.n) onEdit(editing, n)
    setEditing(null)
  }

  return (
    <div className="history">
      <div className="history-header">
        <span className="panel-title">
          Spin History ({spins.length}) <span className="muted">— newest first</span>
        </span>
        <button className="btn btn-small" onClick={onUndo} disabled={spins.length === 0}>
          Undo last
        </button>
      </div>
      {spins.length > 0 && (
        <div className="muted history-hint">Click any spin to correct or remove it.</div>
      )}
      <div className="history-strip">
        {recent.length === 0 && (
          <span className="muted">Tap a number above as each spin lands.</span>
        )}
        {recent.map(({ spin, index }) =>
          editing === index ? (
            <span className="history-edit" key={index}>
              <input
                ref={inputRef}
                value={draft}
                aria-label={`edit spin ${index + 1}`}
                inputMode="numeric"
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
              <button
                className="link danger"
                title="Delete this spin"
                onMouseDown={e => {
                  // Fire before the input's blur so the edit does not commit.
                  e.preventDefault()
                  onDelete(index)
                  setEditing(null)
                }}
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              key={index}
              className={`chip ${colorOf(spin.n)} chip-button`}
              title={`Spin ${index + 1} — click to edit`}
              onClick={() => {
                setEditing(index)
                setDraft(labelOf(spin.n))
              }}
            >
              {labelOf(spin.n)}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
