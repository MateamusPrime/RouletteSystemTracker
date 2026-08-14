import { useMemo, useState } from 'react'
import { martiLegs } from '../../domain/custom/martiInterpreter'
import { buildMartiPlacementSystem } from '../../domain/custom/martiInterpreter'
import type { MartiFamily, MartiPlacementDef } from '../../domain/custom/types'
import { flat } from '../../domain/money/systems'
import { colorOf } from '../../domain/roulette'
import { simulateCombo } from '../../domain/simulation'
import type { Session } from '../../domain/types'

interface Props {
  initial: MartiPlacementDef | null
  session: Session
  onSave(def: MartiPlacementDef): void
  onCancel(): void
}

const ALL_FAMILIES: { key: MartiFamily; label: string; pays: string }[] = [
  { key: 'color', label: 'Colour', pays: '1:1' },
  { key: 'parity', label: 'Odd / Even', pays: '1:1' },
  { key: 'half', label: 'Low / High', pays: '1:1' },
  { key: 'dozen', label: 'Dozen', pays: '2:1' },
  { key: 'column', label: 'Column', pays: '2:1' },
]

/** The felt layout, minus the zeros — an anchor must be a real number. */
const ROWS = [3, 2, 1].map(start => Array.from({ length: 12 }, (_, i) => start + i * 3))

export function MartiBuilder({ initial, session, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [anchor, setAnchor] = useState(initial?.anchor ?? 17)
  const [families, setFamilies] = useState<MartiFamily[]>(
    initial?.families ?? ['color', 'parity', 'half', 'dozen', 'column'],
  )
  const [units, setUnits] = useState(initial?.units ?? 1)
  const [resetEachRound, setResetEachRound] = useState(initial?.resetEachRound ?? true)
  const [includeStraight, setIncludeStraight] = useState(initial?.includeStraight ?? false)

  const draft: MartiPlacementDef = useMemo(
    () => ({
      variant: 'marti',
      id: initial?.id ?? `custom-marti-${crypto.randomUUID()}`,
      name: name.trim() || 'Unnamed Marti GB',
      description: description.trim(),
      anchor,
      // Keep the families in felt order however they were toggled.
      families: ALL_FAMILIES.map(f => f.key).filter(k => families.includes(k)),
      units,
      resetEachRound,
      includeStraight,
    }),
    [initial?.id, name, description, anchor, families, units, resetEachRound, includeStraight],
  )

  const legs = useMemo(() => martiLegs(draft), [draft])

  const preview = useMemo(() => {
    if (session.spins.length === 0 || legs.length === 0) return null
    return simulateCombo(buildMartiPlacementSystem(draft), flat, session.spins, session.config)
  }, [draft, session, legs.length])

  const problems: string[] = []
  if (!name.trim()) problems.push('Give the system a name.')
  if (families.length === 0 && !includeStraight) {
    problems.push('Pick at least one family of bets.')
  }
  if (units <= 0) problems.push('Stake must be positive.')

  const toggleFamily = (key: MartiFamily) =>
    setFamilies(cur => (cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]))

  return (
    <div className="builder-form">
      <div className="builder-form-header">
        <span className="panel-title">
          {initial ? `Edit: ${initial.name}` : 'New Marti GB System'}
        </span>
        <div className="builder-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={problems.length > 0}
            title={problems.join(' ')}
            onClick={() => onSave(draft)}
          >
            Save system
          </button>
        </div>
      </div>

      <div className="field-row">
        <label className="field grow">
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marti GB 17" />
        </label>
        <label className="field">
          Units per leg
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={units}
            onChange={e => setUnits(Math.max(0.1, Number(e.target.value) || 1))}
          />
        </label>
      </div>
      <label className="field">
        Description
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What is the idea behind this system?"
        />
      </label>

      <div className="stat-title">Anchor number — its properties become the legs</div>
      <div className="marti-board">
        {ROWS.map((row, r) => (
          <div className="numberpad-row" key={r}>
            {row.map(n => (
              <button
                key={n}
                type="button"
                className={`pocket ${colorOf(n)} ${n === anchor ? 'picked' : 'dim'}`}
                onClick={() => setAnchor(n)}
              >
                {n}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="stat-title">Families to play</div>
      <div className="gb-legs">
        {ALL_FAMILIES.map(f => (
          <button
            key={f.key}
            type="button"
            className={`gb-leg ${families.includes(f.key) ? 'picked' : ''}`}
            onClick={() => toggleFamily(f.key)}
          >
            {f.label}
            <small>{f.pays}</small>
          </button>
        ))}
        <button
          type="button"
          className={`gb-leg ${includeStraight ? 'picked' : ''}`}
          onClick={() => setIncludeStraight(v => !v)}
          title="Also play the anchor number itself, straight up"
        >
          The number itself
          <small>35:1</small>
        </button>
      </div>

      <div className="marti-legs">
        <span className="stat-title">Number {anchor} plays:</span>
        {legs.length === 0 ? (
          <span className="muted">pick at least one family</span>
        ) : (
          legs.map(l => (
            <span className="syscard-chip" key={l.label}>
              {l.label} <small className="muted">({l.family})</small>
            </span>
          ))
        )}
      </div>

      <label className="field">
        Between rounds
        <select
          value={resetEachRound ? 'reset' : 'carry'}
          onChange={e => setResetEachRound(e.target.value === 'reset')}
        >
          <option value="reset">Every leg goes back to the opening bet</option>
          <option value="carry">Each leg carries its progression onward</option>
        </select>
      </label>
      <div className="muted hint">
        All the legs start together. A leg that <strong>wins</strong> stands down and is not
        re-bet until every other leg has won too — then the round is complete and they all
        come back{resetEachRound ? ' on the opening bet' : ' carrying their progressions'}.
        Each leg keeps its own money management, and they all share one bankroll.
      </div>

      <div className="builder-preview">
        <span className="stat-title">Live preview vs this session (flat betting)</span>
        {preview === null ? (
          <span className="muted">
            {legs.length === 0
              ? 'Pick at least one family to preview.'
              : 'Record spins in the tracker to preview performance.'}
          </span>
        ) : (
          <div className="preview-line">
            <span className={preview.profit >= 0 ? 'pos' : 'neg'}>
              {preview.profit >= 0 ? '+' : '-'}${Math.abs(preview.profit).toFixed(0)}
            </span>
            <span>{preview.wins}W-{preview.losses}L, {preview.sitOuts} sat out</span>
            <span className="muted">peak stake ${preview.peakStake.toFixed(0)}</span>
            {preview.ruinedAt !== null && (
              <span className="neg">out of money on spin {preview.ruinedAt}</span>
            )}
            <span className="muted">
              next:{' '}
              {preview.nextBets.length === 0
                ? 'round complete / no leg live'
                : preview.nextBets.map(b => `$${b.amount.toFixed(0)} ${b.label}`).join(' · ')}
            </span>
          </div>
        )}
      </div>
      {problems.length > 0 && <div className="builder-problems">{problems.join(' ')}</div>}
    </div>
  )
}
