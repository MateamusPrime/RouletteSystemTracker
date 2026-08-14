import { useMemo, useState } from 'react'
import {
  GB_BET_INFO,
  GB_BET_ORDER,
  buildGbPlacementSystem,
  legInfo,
} from '../../domain/custom/gbInterpreter'
import { gbLegTarget } from '../../domain/custom/types'
import type { GbLegDef, GbLegKind, GbPlacementDef, GbTrigger } from '../../domain/custom/types'
import { BoardEditor } from './BoardEditor'
import { flat } from '../../domain/money/systems'
import { simulateCombo } from '../../domain/simulation'
import type { Session } from '../../domain/types'

interface Props {
  initial: GbPlacementDef | null
  session: Session
  onSave(def: GbPlacementDef): void
  onCancel(): void
}

const DEFAULT_TRIGGER: GbTrigger = { kind: 'asleep', spins: 5 }

function defaultTrigger(kind: GbTrigger['kind']): GbTrigger {
  if (kind === 'always') return { kind: 'always' }
  if (kind === 'hot') return { kind: 'hot', window: 12, times: 5 }
  return { kind: 'asleep', spins: 5 }
}

/** The three groups of outside bets, so the picker reads like the felt. */
const GROUPS: { title: string; kinds: GbLegKind[] }[] = [
  { title: 'Even money', kinds: ['red', 'black', 'odd', 'even', 'low', 'high'] },
  { title: 'Dozens', kinds: ['dozen1', 'dozen2', 'dozen3'] },
  { title: 'Columns', kinds: ['column1', 'column2', 'column3'] },
]

export function GbBuilder({ initial, session, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [legs, setLegs] = useState<GbLegDef[]>(initial?.legs ?? [])

  const draft: GbPlacementDef = useMemo(
    () => ({
      variant: 'gb',
      id: initial?.id ?? `custom-gb-${crypto.randomUUID()}`,
      name: name.trim() || 'Unnamed GB system',
      description: description.trim(),
      // Keep the legs in felt order however they were toggled on.
      legs,
    }),
    [initial?.id, name, description, legs],
  )

  const preview = useMemo(() => {
    if (session.spins.length === 0 || legs.length === 0) return null
    return simulateCombo(buildGbPlacementSystem(draft), flat, session.spins, session.config)
  }, [draft, session, legs.length])

  /** Legs are identified by what they cover, however they were added. */
  const keyOf = (leg: GbLegDef) => legInfo(leg).label
  const legFor = (kind: GbLegKind) =>
    legs.find(l => {
      const t = gbLegTarget(l)
      return t.kind === 'fixed' && t.bet === kind
    })

  const toggle = (kind: GbLegKind) =>
    setLegs(cur =>
      cur.some(l => {
        const t = gbLegTarget(l)
        return t.kind === 'fixed' && t.bet === kind
      })
        ? cur.filter(l => {
            const t = gbLegTarget(l)
            return !(t.kind === 'fixed' && t.bet === kind)
          })
        : [...cur, { target: { kind: 'fixed', bet: kind }, units: 1, trigger: DEFAULT_TRIGGER }],
    )

  const toggleCombo = (numbers: number[]) => {
    const id = numbers.join('-')
    setLegs(cur => {
      const has = cur.some(l => {
        const t = gbLegTarget(l)
        return t.kind === 'combo' && t.numbers.join('-') === id
      })
      if (has) {
        return cur.filter(l => {
          const t = gbLegTarget(l)
          return !(t.kind === 'combo' && t.numbers.join('-') === id)
        })
      }
      return [...cur, { target: { kind: 'combo', numbers }, units: 1, trigger: DEFAULT_TRIGGER }]
    })
  }

  const update = (key: string, patch: Partial<GbLegDef>) =>
    setLegs(cur => cur.map(l => (keyOf(l) === key ? { ...l, ...patch } : l)))

  const removeLeg = (key: string) => setLegs(cur => cur.filter(l => keyOf(l) !== key))

  /** Applies one setting to every selected leg — the usual way to build these. */
  const applyToAll = (patch: Partial<GbLegDef>) =>
    setLegs(cur => cur.map(l => ({ ...l, ...patch })))

  const problems: string[] = []
  if (!name.trim()) problems.push('Give the system a name.')
  if (legs.length === 0) problems.push('Pick at least one leg to watch.')
  if (legs.some(l => l.units <= 0)) problems.push('Every leg needs a positive stake.')

  return (
    <div className="builder-form">
      <div className="builder-form-header">
        <span className="panel-title">{initial ? `Edit: ${initial.name}` : 'New GB System'}</span>
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
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Outside Sleeper GB"
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

      <div className="muted hint">
        Every leg you pick runs as an independent bet with its own money-management
        progression — one can reset after a win on the very spin another doubles down —
        while all of them draw on the same bankroll. Several legs waking together stack
        up fast, so watch the stake.
      </div>

      <div className="rules-header">
        <span className="stat-title">Legs to watch ({legs.length} of 12)</span>
        <div className="builder-actions">
          <button
            className="btn btn-small"
            onClick={() =>
              setLegs(
                GB_BET_ORDER.map(bet => ({
                  target: { kind: 'fixed' as const, bet },
                  units: 1,
                  trigger: DEFAULT_TRIGGER,
                })),
              )
            }
          >
            Select all 12
          </button>
          <button className="btn btn-small" onClick={() => setLegs([])} disabled={legs.length === 0}>
            Clear
          </button>
        </div>
      </div>

      <div className="stat-title">Inside bets — click the felt to add a leg</div>
      <BoardEditor
        bets={legs
          .map(l => gbLegTarget(l))
          .filter((t): t is { kind: 'combo'; numbers: number[] } => t.kind === 'combo')
          .map(t => ({ target: t, units: 1 }))}
        onToggleOutside={kind => toggle(kind)}
        onToggleNumber={n => toggleCombo([n])}
        onToggleCombo={toggleCombo}
        formatAmount={() => ''}
      />
      <div className="muted hint">
        A single pocket is a straight-up leg at 35:1; the dots on the lines add splits,
        streets, corners and six lines. Outside boxes toggle the same legs as the
        buttons below.
      </div>

      {GROUPS.map(group => (
        <div className="gb-group" key={group.title}>
          <div className="stat-title">{group.title}</div>
          <div className="gb-legs">
            {group.kinds.map(kind => {
              const leg = legFor(kind)
              return (
                <button
                  key={kind}
                  type="button"
                  className={`gb-leg ${leg ? 'picked' : ''}`}
                  onClick={() => toggle(kind)}
                >
                  {GB_BET_INFO[kind].label}
                  <small>{GB_BET_INFO[kind].payout}:1</small>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {legs.length > 0 && (
        <>
          <div className="rules-header">
            <span className="stat-title">Trigger and stake per leg</span>
            <div className="builder-actions">
              <select
                value=""
                onChange={e => {
                  if (!e.target.value) return
                  applyToAll({ trigger: defaultTrigger(e.target.value as GbTrigger['kind']) })
                }}
                title="Apply one trigger to every leg"
              >
                <option value="">Set all triggers to…</option>
                <option value="asleep">Asleep for N spins</option>
                <option value="hot">Hot in a window</option>
                <option value="always">Every spin</option>
              </select>
            </div>
          </div>

          {legs.map(leg => {
            const kind = keyOf(leg)
            return (
              <div className="field-row gb-leg-row" key={kind}>
                <span className="bet-line-label">{kind}</span>
                <label className="field">
                  Starts when
                  <select
                    value={leg.trigger.kind}
                    onChange={e =>
                      update(kind, { trigger: defaultTrigger(e.target.value as GbTrigger['kind']) })
                    }
                  >
                    <option value="asleep">Asleep for N spins</option>
                    <option value="hot">Hot in a window</option>
                    <option value="always">Every spin</option>
                  </select>
                </label>
                {leg.trigger.kind === 'asleep' && (
                  <label className="field">
                    Spins asleep
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={leg.trigger.spins}
                      onChange={e =>
                        update(kind, {
                          trigger: {
                            kind: 'asleep',
                            spins: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                          },
                        })
                      }
                    />
                  </label>
                )}
                {leg.trigger.kind === 'hot' && (
                  <>
                    <label className="field">
                      Hits
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={leg.trigger.times}
                        onChange={e =>
                          update(kind, {
                            trigger: {
                              kind: 'hot',
                              window: (leg.trigger as { window: number }).window,
                              times: Math.max(1, Number(e.target.value) || 1),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      In last
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={leg.trigger.window}
                        onChange={e =>
                          update(kind, {
                            trigger: {
                              kind: 'hot',
                              times: (leg.trigger as { times: number }).times,
                              window: Math.max(1, Number(e.target.value) || 1),
                            },
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <label className="field">
                  Units
                  <input
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={leg.units}
                    onChange={e =>
                      update(kind, { units: Math.max(0.1, Number(e.target.value) || 1) })
                    }
                  />
                </label>
                <button className="link danger" onClick={() => removeLeg(kind)}>
                  Remove
                </button>
              </div>
            )
          })}
        </>
      )}

      <div className="builder-preview">
        <span className="stat-title">Live preview vs this session (flat betting)</span>
        {preview === null ? (
          <span className="muted">
            {legs.length === 0
              ? 'Pick at least one leg to preview.'
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
                ? 'no leg awake'
                : preview.nextBets.map(b => `$${b.amount.toFixed(0)} ${b.label}`).join(' · ')}
            </span>
          </div>
        )}
      </div>
      {problems.length > 0 && <div className="builder-problems">{problems.join(' ')}</div>}
    </div>
  )
}
