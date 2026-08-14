import { useMemo, useState } from 'react'
import { buildPlacementSystem } from '../../domain/custom/placementInterpreter'
import type {
  BetRule,
  ConditionDef,
  FixedBetKind,
  PlacementDef,
  TargetDef,
} from '../../domain/custom/types'
import { flat } from '../../domain/money/systems'
import { DOUBLE_ZERO, colorOf, labelOf } from '../../domain/roulette'
import { simulateCombo } from '../../domain/simulation'
import type { Session } from '../../domain/types'

interface Props {
  initial: PlacementDef | null
  session: Session
  onSave(def: PlacementDef): void
  onCancel(): void
}

const TARGET_KINDS: { kind: TargetDef['kind']; label: string }[] = [
  { kind: 'fixed', label: 'Fixed bet (red, dozen 2, …)' },
  { kind: 'numbers', label: 'Custom numbers (straight-up)' },
  { kind: 'hotGroup', label: 'Hottest dozen/column' },
  { kind: 'coldGroup', label: 'Coldest dozen/column' },
  { kind: 'hotNumbers', label: 'Hottest numbers' },
  { kind: 'coldNumbers', label: 'Coldest numbers (sleepers)' },
  { kind: 'lastColor', label: 'Color of last spin' },
  { kind: 'oppositeLastColor', label: 'Opposite color of last spin' },
  { kind: 'lastDozen', label: 'Dozen of last spin' },
  { kind: 'lastColumn', label: 'Column of last spin' },
  { kind: 'neighbours', label: 'Wheel neighbours of last number' },
  { kind: 'repeatLast', label: 'Repeat the last number' },
]

const FIXED_BETS: { value: FixedBetKind; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'black', label: 'Black' },
  { value: 'odd', label: 'Odd' },
  { value: 'even', label: 'Even' },
  { value: 'low', label: '1-18' },
  { value: 'high', label: '19-36' },
  { value: 'dozen1', label: '1st Dozen' },
  { value: 'dozen2', label: '2nd Dozen' },
  { value: 'dozen3', label: '3rd Dozen' },
  { value: 'column1', label: 'Column 1' },
  { value: 'column2', label: 'Column 2' },
  { value: 'column3', label: 'Column 3' },
]

const CONDITION_KINDS: { kind: ConditionDef['kind']; label: string }[] = [
  { kind: 'always', label: 'Every spin' },
  { kind: 'streak', label: 'After a streak' },
  { kind: 'targetSleeping', label: 'Target asleep for N spins' },
  { kind: 'targetHitting', label: 'Target hot (≥ X hits in N spins)' },
]

function defaultTarget(kind: TargetDef['kind']): TargetDef {
  switch (kind) {
    case 'fixed':
      return { kind, bet: 'red' }
    case 'numbers':
      return { kind, numbers: [] }
    case 'hotGroup':
      return { kind, group: 'dozen', window: 12, rank: 1 }
    case 'coldGroup':
      return { kind, group: 'dozen', window: 12 }
    case 'hotNumbers':
      return { kind, count: 3, window: 24 }
    case 'coldNumbers':
      return { kind, count: 3, window: 24 }
    case 'neighbours':
      return { kind, span: 2 }
    default:
      return { kind } as TargetDef
  }
}

function defaultCondition(kind: ConditionDef['kind']): ConditionDef {
  switch (kind) {
    case 'always':
      return { kind }
    case 'streak':
      return { kind, group: 'color', length: 3 }
    case 'targetSleeping':
      return { kind, gap: 6 }
    case 'targetHitting':
      return { kind, window: 12, minHits: 3 }
  }
}

function newRule(): BetRule {
  return { target: defaultTarget('fixed'), condition: { kind: 'always' }, units: 1 }
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max?: number
  onChange(v: number): void
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => {
          const v = Number(e.target.value)
          if (!Number.isFinite(v)) return
          onChange(Math.max(min, max !== undefined ? Math.min(v, max) : v))
        }}
      />
    </label>
  )
}

function NumberGrid({
  selected,
  onToggle,
}: {
  selected: number[]
  onToggle(n: number): void
}) {
  const all = [0, ...Array.from({ length: 36 }, (_, i) => i + 1), DOUBLE_ZERO]
  const set = new Set(selected)
  return (
    <div className="mini-grid">
      {all.map(n => (
        <button
          key={n}
          type="button"
          className={`pocket mini ${colorOf(n)} ${set.has(n) ? 'picked' : 'dim'}`}
          onClick={() => onToggle(n)}
        >
          {labelOf(n)}
        </button>
      ))}
    </div>
  )
}

function TargetEditor({ target, onChange }: { target: TargetDef; onChange(t: TargetDef): void }) {
  return (
    <div className="rule-params">
      {target.kind === 'fixed' && (
        <label className="field">
          Bet
          <select
            value={target.bet}
            onChange={e => onChange({ ...target, bet: e.target.value as FixedBetKind })}
          >
            {FIXED_BETS.map(b => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {target.kind === 'numbers' && (
        <NumberGrid
          selected={target.numbers}
          onToggle={n =>
            onChange({
              ...target,
              numbers: target.numbers.includes(n)
                ? target.numbers.filter(x => x !== n)
                : [...target.numbers, n].sort((a, b) => a - b),
            })
          }
        />
      )}
      {(target.kind === 'hotGroup' || target.kind === 'coldGroup') && (
        <>
          <label className="field">
            Group
            <select
              value={target.group}
              onChange={e => onChange({ ...target, group: e.target.value as 'dozen' | 'column' })}
            >
              <option value="dozen">Dozen</option>
              <option value="column">Column</option>
            </select>
          </label>
          <NumberInput
            label="Look-back (spins)"
            value={target.window}
            min={1}
            max={200}
            onChange={window => onChange({ ...target, window })}
          />
          {target.kind === 'hotGroup' && (
            <label className="field">
              Rank
              <select
                value={target.rank}
                onChange={e => onChange({ ...target, rank: Number(e.target.value) as 1 | 2 })}
              >
                <option value={1}>Hottest</option>
                <option value={2}>2nd hottest</option>
              </select>
            </label>
          )}
        </>
      )}
      {(target.kind === 'hotNumbers' || target.kind === 'coldNumbers') && (
        <>
          <NumberInput
            label="How many numbers"
            value={target.count}
            min={1}
            max={12}
            onChange={count => onChange({ ...target, count })}
          />
          <NumberInput
            label="Look-back (spins)"
            value={target.window}
            min={1}
            max={200}
            onChange={window => onChange({ ...target, window })}
          />
        </>
      )}
      {target.kind === 'neighbours' && (
        <NumberInput
          label="Neighbours each side"
          value={target.span}
          min={1}
          max={5}
          onChange={span => onChange({ ...target, span })}
        />
      )}
    </div>
  )
}

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: ConditionDef
  onChange(c: ConditionDef): void
}) {
  return (
    <div className="rule-params">
      {condition.kind === 'streak' && (
        <>
          <label className="field">
            Streak of
            <select
              value={condition.group}
              onChange={e =>
                onChange({ ...condition, group: e.target.value as typeof condition.group })
              }
            >
              <option value="color">Same color</option>
              <option value="oddEven">Same odd/even</option>
              <option value="highLow">Same high/low</option>
              <option value="dozen">Same dozen</option>
              <option value="column">Same column</option>
            </select>
          </label>
          <NumberInput
            label="Streak length ≥"
            value={condition.length}
            min={2}
            max={20}
            onChange={length => onChange({ ...condition, length })}
          />
        </>
      )}
      {condition.kind === 'targetSleeping' && (
        <NumberInput
          label="Asleep for ≥ (spins)"
          value={condition.gap}
          min={1}
          max={100}
          onChange={gap => onChange({ ...condition, gap })}
        />
      )}
      {condition.kind === 'targetHitting' && (
        <>
          <NumberInput
            label="Window (spins)"
            value={condition.window}
            min={1}
            max={100}
            onChange={window => onChange({ ...condition, window })}
          />
          <NumberInput
            label="Min hits"
            value={condition.minHits}
            min={1}
            max={50}
            onChange={minHits => onChange({ ...condition, minHits })}
          />
        </>
      )}
    </div>
  )
}

export function PlacementBuilder({ initial, session, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [minSpins, setMinSpins] = useState(initial?.minSpins ?? 0)
  const [rules, setRules] = useState<BetRule[]>(initial?.rules ?? [newRule()])

  const draft: PlacementDef = useMemo(
    () => ({
      id: initial?.id ?? `custom-p-${crypto.randomUUID()}`,
      name: name.trim() || 'Unnamed system',
      description: description.trim(),
      minSpins,
      rules,
    }),
    [initial?.id, name, description, minSpins, rules],
  )

  const preview = useMemo(() => {
    if (session.spins.length === 0) return null
    return simulateCombo(buildPlacementSystem(draft), flat, session.spins, session.config)
  }, [draft, session])

  const problems: string[] = []
  if (!name.trim()) problems.push('Give the system a name.')
  if (rules.length === 0) problems.push('Add at least one bet rule.')
  for (const [i, r] of rules.entries()) {
    if (r.target.kind === 'numbers' && r.target.numbers.length === 0) {
      problems.push(`Rule ${i + 1}: pick at least one number.`)
    }
    if (r.units <= 0) problems.push(`Rule ${i + 1}: units must be positive.`)
  }

  const updateRule = (i: number, rule: BetRule) =>
    setRules(rs => rs.map((r, j) => (j === i ? rule : r)))

  return (
    <div className="builder-form">
      <div className="builder-form-header">
        <span className="panel-title">
          {initial ? `Edit: ${initial.name}` : 'New Placement System'}
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
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sleeper Column Hunter" />
        </label>
        <NumberInput label="Wait for N spins first" value={minSpins} min={0} max={100} onChange={setMinSpins} />
      </div>
      <label className="field">
        Description
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What is the idea behind this system?"
        />
      </label>

      <div className="rules-header">
        <span className="stat-title">Bet rules (all matching rules fire together each spin)</span>
        <button className="btn btn-small" onClick={() => setRules(rs => [...rs, newRule()])}>
          + Add rule
        </button>
      </div>

      {rules.map((rule, i) => (
        <div className="rule-card" key={i}>
          <div className="rule-card-top">
            <span className="rule-index">Rule {i + 1}</span>
            <button
              className="link danger"
              onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="field-row">
            <label className="field grow">
              Bet on
              <select
                value={rule.target.kind}
                onChange={e =>
                  updateRule(i, { ...rule, target: defaultTarget(e.target.value as TargetDef['kind']) })
                }
              >
                {TARGET_KINDS.map(t => (
                  <option key={t.kind} value={t.kind}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberInput
              label="Units"
              value={rule.units}
              min={0.5}
              max={100}
              onChange={units => updateRule(i, { ...rule, units })}
            />
          </div>
          <TargetEditor target={rule.target} onChange={target => updateRule(i, { ...rule, target })} />
          <div className="field-row">
            <label className="field grow">
              When to bet
              <select
                value={rule.condition.kind}
                onChange={e =>
                  updateRule(i, {
                    ...rule,
                    condition: defaultCondition(e.target.value as ConditionDef['kind']),
                  })
                }
              >
                {CONDITION_KINDS.map(c => (
                  <option key={c.kind} value={c.kind}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ConditionEditor
            condition={rule.condition}
            onChange={condition => updateRule(i, { ...rule, condition })}
          />
        </div>
      ))}

      <div className="builder-preview">
        <span className="stat-title">Live preview vs this session (flat betting)</span>
        {preview === null ? (
          <span className="muted">Record spins in the tracker to preview performance.</span>
        ) : (
          <div className="preview-line">
            <span className={preview.profit >= 0 ? 'pos' : 'neg'}>
              {preview.profit >= 0 ? '+' : '-'}${Math.abs(preview.profit).toFixed(0)}
            </span>
            <span>{preview.wins}W-{preview.losses}L, {preview.sitOuts} sat out</span>
            <span className="muted">
              Next spin:{' '}
              {preview.nextBets.length === 0
                ? 'sits out'
                : preview.nextBets.map(b => `$${b.amount.toFixed(0)} ${b.label}`).join(' · ')}
            </span>
          </div>
        )}
      </div>
      {problems.length > 0 && <div className="builder-problems">{problems.join(' ')}</div>}
    </div>
  )
}
