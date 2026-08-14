import { useMemo, useState } from 'react'
import { buildMoneySystem } from '../../domain/custom/moneyInterpreter'
import type { MoneyDef, MoneyStepDef, SeqAction, StepAction } from '../../domain/custom/types'
import { alwaysRed } from '../../domain/placement/systems'
import { simulateCombo } from '../../domain/simulation'
import type { Session } from '../../domain/types'

interface Props {
  initial: MoneyDef | null
  session: Session
  onSave(def: MoneyDef): void
  onCancel(): void
}

type Mode = MoneyDef['mode']

const STEP_OPS: { value: StepAction['op']; label: string }[] = [
  { value: 'reset', label: 'Reset to start' },
  { value: 'hold', label: 'Keep the same' },
  { value: 'add', label: 'Add units' },
  { value: 'subtract', label: 'Subtract units' },
  { value: 'multiply', label: 'Multiply by' },
  { value: 'divide', label: 'Divide by' },
]

const SEQ_OPS: { value: SeqAction['op']; label: string }[] = [
  { value: 'forward', label: 'Move forward' },
  { value: 'back', label: 'Move back' },
  { value: 'reset', label: 'Back to start' },
  { value: 'hold', label: 'Stay in place' },
]

/** Setters a preset may drive; keeps the preset table declarative. */
interface PresetSetters {
  setMode(m: Mode): void
  setStart(v: number): void
  setOnWin(a: StepAction): void
  setOnLoss(a: StepAction): void
  setWinStreakReset(v: number): void
  setCap(v: number): void
  setSeqText(v: string): void
  setSeqOnWin(a: SeqAction): void
  setSeqOnLoss(a: SeqAction): void
  setEndBehavior(v: 'clamp' | 'reset'): void
  setLineText(v: string): void
  setCycleTarget(v: number): void
  setCycleStopLoss(v: number): void
  setMaxCycles(v: number): void
  setStopWin(v: number): void
  setStopLoss(v: number): void
  setAheadFactor(v: number): void
  setBehindFactor(v: number): void
}

/** Clears every guard so presets never inherit leftovers. */
function clearGuards(s: PresetSetters) {
  s.setCycleTarget(0)
  s.setCycleStopLoss(0)
  s.setMaxCycles(0)
  s.setStopWin(0)
  s.setStopLoss(0)
  s.setAheadFactor(1)
  s.setBehindFactor(1)
}

const PRESETS: {
  id: string
  name: string
  description: string
  apply(s: PresetSetters): void
}[] = [
  {
    id: 'climb-bank',
    name: 'Climb & Bank',
    description: 'add 1 unit every spin, reset to the opening stake at +10 units profit, repeat',
    apply: s => {
      clearGuards(s)
      s.setMode('progression')
      s.setStart(1)
      s.setOnWin({ op: 'add', value: 1 })
      s.setOnLoss({ op: 'add', value: 1 })
      s.setWinStreakReset(0)
      s.setCycleTarget(10)
    },
  },
  {
    id: 'martingale',
    name: 'Martingale',
    description: 'double after a loss, reset after a win',
    apply: s => {
      clearGuards(s)
      s.setMode('progression')
      s.setStart(1)
      s.setOnWin({ op: 'reset', value: 1 })
      s.setOnLoss({ op: 'multiply', value: 2 })
      s.setWinStreakReset(0)
    },
  },
  {
    id: 'dalembert',
    name: "D'Alembert",
    description: '+1 unit after a loss, −1 after a win',
    apply: s => {
      clearGuards(s)
      s.setMode('progression')
      s.setStart(1)
      s.setOnWin({ op: 'subtract', value: 1 })
      s.setOnLoss({ op: 'add', value: 1 })
      s.setWinStreakReset(0)
    },
  },
  {
    id: 'paroli',
    name: 'Paroli',
    description: 'double after a win, reset after 3 wins or any loss',
    apply: s => {
      clearGuards(s)
      s.setMode('progression')
      s.setStart(1)
      s.setOnWin({ op: 'multiply', value: 2 })
      s.setOnLoss({ op: 'reset', value: 1 })
      s.setWinStreakReset(3)
    },
  },
  {
    id: 'ladder-1326',
    name: '1-3-2-6 ladder',
    description: 'step forward on wins, back to the start on a loss',
    apply: s => {
      clearGuards(s)
      s.setMode('sequence')
      s.setSeqText('1, 3, 2, 6')
      s.setSeqOnWin({ op: 'forward', steps: 1 })
      s.setSeqOnLoss({ op: 'reset', steps: 1 })
      s.setEndBehavior('reset')
    },
  },
  {
    id: 'labouchere',
    name: 'Labouchere 1-2-3-4',
    description: 'cancellation line, cross off on wins',
    apply: s => {
      clearGuards(s)
      s.setMode('cancellation')
      s.setLineText('1, 2, 3, 4')
    },
  },
]

function parseNumberList(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map(t => Number(t))
    .filter(v => Number.isFinite(v) && v > 0)
}

function StepActionEditor({
  label,
  action,
  onChange,
}: {
  label: string
  action: StepAction
  onChange(a: StepAction): void
}) {
  const needsValue = action.op !== 'reset' && action.op !== 'hold'
  return (
    <div className="field-row">
      <label className="field grow">
        {label}
        <select
          value={action.op}
          onChange={e => onChange({ ...action, op: e.target.value as StepAction['op'] })}
        >
          {STEP_OPS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {needsValue && (
        <label className="field">
          Value
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={action.value}
            onChange={e => onChange({ ...action, value: Math.max(0.1, Number(e.target.value) || 0.1) })}
          />
        </label>
      )}
    </div>
  )
}

function SeqActionEditor({
  label,
  action,
  onChange,
}: {
  label: string
  action: SeqAction
  onChange(a: SeqAction): void
}) {
  const needsSteps = action.op === 'forward' || action.op === 'back'
  return (
    <div className="field-row">
      <label className="field grow">
        {label}
        <select
          value={action.op}
          onChange={e => onChange({ ...action, op: e.target.value as SeqAction['op'] })}
        >
          {SEQ_OPS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {needsSteps && (
        <label className="field">
          Steps
          <input
            type="number"
            min={1}
            max={10}
            value={action.steps}
            onChange={e => onChange({ ...action, steps: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
      )}
    </div>
  )
}

export function MoneyBuilder({ initial, session, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'progression')
  const [cap, setCap] = useState(initial?.cap ?? 256)
  const [previewUnit, setPreviewUnit] = useState(
    initial?.previewUnit ?? session.config.baseUnit,
  )
  const [amountMode, setAmountMode] = useState<'units' | 'dollars'>('units')

  /** "$5" for 1 unit at the current preview unit value. */
  const dollars = (units: number) =>
    `${units < 0 ? '-' : ''}$${parseFloat(Math.abs(units * previewUnit).toFixed(2))}`

  /** Formats an amount in the currently selected entry mode. */
  const fmtAmt = (v: number) =>
    amountMode === 'dollars'
      ? dollars(v)
      : `${v < 0 ? '-' : ''}${parseFloat(Math.abs(v).toFixed(2))}u`
  const fmtNet = (v: number) => `${v > 0 ? '+' : ''}${fmtAmt(v)}`
  /** Both denominations, for places where clarity beats brevity. */
  const both = (v: number) => `${parseFloat(v.toFixed(2))}u (${dollars(v)})`

  /** A number input that edits a unit value, optionally entered in dollars. */
  const AmountInput = ({
    value,
    min = 0,
    step = 0.5,
    onChange,
  }: {
    value: number
    min?: number
    step?: number
    onChange(units: number): void
  }) =>
    amountMode === 'dollars' ? (
      <input
        type="number"
        min={min * previewUnit}
        step={Math.max(0.5, step * previewUnit)}
        value={parseFloat((value * previewUnit).toFixed(2))}
        onChange={e => onChange(Math.max(min, (Number(e.target.value) || 0) / previewUnit))}
      />
    ) : (
      <input
        type="number"
        min={min}
        step={step}
        value={parseFloat(value.toFixed(2))}
        onChange={e => onChange(Math.max(min, Number(e.target.value) || 0))}
      />
    )

  const amtLabel = amountMode === 'dollars' ? '$' : 'units'

  // Progression fields
  const p = initial?.mode === 'progression' ? initial : null
  const [start, setStart] = useState(p?.start ?? 1)
  const [onWin, setOnWin] = useState<StepAction>(p?.onWin ?? { op: 'reset', value: 1 })
  const [onLoss, setOnLoss] = useState<StepAction>(p?.onLoss ?? { op: 'multiply', value: 2 })
  const [winStreakReset, setWinStreakReset] = useState(p?.winStreakReset ?? 0)

  // Sequence fields
  const q = initial?.mode === 'sequence' ? initial : null
  const [seqText, setSeqText] = useState(q ? q.sequence.join(', ') : '1, 3, 2, 6')
  const [seqOnWin, setSeqOnWin] = useState<SeqAction>(q?.onWin ?? { op: 'forward', steps: 1 })
  const [seqOnLoss, setSeqOnLoss] = useState<SeqAction>(q?.onLoss ?? { op: 'reset', steps: 1 })
  const [endBehavior, setEndBehavior] = useState<'clamp' | 'reset'>(q?.endBehavior ?? 'reset')

  // Cancellation fields
  const c = initial?.mode === 'cancellation' ? initial : null
  const [lineText, setLineText] = useState(c ? c.line.join(', ') : '1, 2, 3, 4')

  // Session guards (apply to every style)
  const g = initial?.guards
  const [stopWin, setStopWin] = useState(g?.stopWinUnits ?? 0)
  const [stopLoss, setStopLoss] = useState(g?.stopLossUnits ?? 0)
  const [aheadFactor, setAheadFactor] = useState(g?.aheadFactor ?? 1)
  const [behindFactor, setBehindFactor] = useState(g?.behindFactor ?? 1)
  const [cycleTarget, setCycleTarget] = useState(g?.cycleTargetUnits ?? 0)
  const [cycleBasis, setCycleBasis] = useState<'milestones' | 'from-cycle-start'>(
    g?.cycleBasis ?? 'milestones',
  )
  const [cycleStopLoss, setCycleStopLoss] = useState(g?.cycleStopLossUnits ?? 0)
  const [maxCycles, setMaxCycles] = useState(g?.maxCycles ?? 0)

  // Step-machine fields
  const st = initial?.mode === 'steps' ? initial : null
  const [moneySteps, setMoneySteps] = useState<MoneyStepDef[]>(
    st?.steps ?? [
      { mult: 1, onWin: 'stay', onLoss: 1 },
      { mult: 2, onWin: 0, onLoss: 'stay' },
    ],
  )

  const draft: MoneyDef = useMemo(() => {
    const base = {
      id: initial?.id ?? `custom-m-${crypto.randomUUID()}`,
      name: name.trim() || 'Unnamed system',
      description: description.trim(),
      cap,
      previewUnit,
      guards: {
        stopWinUnits: stopWin > 0 ? stopWin : null,
        stopLossUnits: stopLoss > 0 ? stopLoss : null,
        aheadFactor,
        behindFactor,
        cycleTargetUnits: cycleTarget > 0 ? cycleTarget : null,
        cycleBasis,
        cycleStopLossUnits: cycleStopLoss > 0 ? cycleStopLoss : null,
        maxCycles: maxCycles > 0 ? maxCycles : null,
      },
    }
    if (mode === 'progression') {
      return { ...base, mode, start, onWin, onLoss, winStreakReset }
    }
    if (mode === 'sequence') {
      return {
        ...base,
        mode,
        sequence: parseNumberList(seqText),
        onWin: seqOnWin,
        onLoss: seqOnLoss,
        endBehavior,
      }
    }
    if (mode === 'steps') {
      return { ...base, mode, steps: moneySteps }
    }
    return { ...base, mode: 'cancellation', line: parseNumberList(lineText) }
  }, [
    initial?.id, name, description, cap, mode, start, onWin, onLoss,
    winStreakReset, seqText, seqOnWin, seqOnLoss, endBehavior, lineText, moneySteps,
    stopWin, stopLoss, aheadFactor, behindFactor, previewUnit,
    cycleTarget, cycleStopLoss, maxCycles, cycleBasis,
  ])

  const preview = useMemo(() => {
    if (session.spins.length === 0) return null
    return simulateCombo(alwaysRed, buildMoneySystem(draft), session.spins, session.config)
  }, [draft, session])

  const problems: string[] = []
  if (!name.trim()) problems.push('Give the system a name.')
  if (mode === 'sequence' && parseNumberList(seqText).length === 0) {
    problems.push('Sequence needs at least one positive number.')
  }
  if (mode === 'cancellation' && parseNumberList(lineText).length === 0) {
    problems.push('Cancellation line needs at least one positive number.')
  }
  if (mode === 'steps' && moneySteps.length === 0) {
    problems.push('Add at least one step.')
  }
  if (cap < 1) problems.push('Cap must be at least 1.')

  return (
    <div className="builder-form">
      <div className="builder-form-header">
        <span className="panel-title">
          {initial ? `Edit: ${initial.name}` : 'New Money Management System'}
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
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gentle Grind" />
        </label>
        <label className="field">
          Max stake cap ({amtLabel})
          <AmountInput value={cap} min={1} step={1} onChange={setCap} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Unit value $ (display only)
          <input
            type="number"
            min={0.01}
            step={1}
            value={previewUnit}
            onChange={e => setPreviewUnit(Math.max(0.01, Number(e.target.value) || 1))}
          />
        </label>
        <label className="field">
          Enter amounts as
          <select value={amountMode} onChange={e => setAmountMode(e.target.value as 'units' | 'dollars')}>
            <option value="units">Units</option>
            <option value="dollars">Dollars</option>
          </select>
        </label>
        <span className="field muted hint">
          1u = {dollars(1)} · the simulator always uses the session's unit size;
          dollars here convert to units under the hood.
        </span>
      </div>
      <label className="field">
        Description
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="How does this staking plan work?"
        />
      </label>

      <label className="field">
        Start from a preset
        <select
          value=""
          onChange={e => {
            const p = PRESETS.find(x => x.id === e.target.value)
            if (!p) return
            p.apply({
              setMode, setStart, setOnWin, setOnLoss, setWinStreakReset, setCap,
              setSeqText, setSeqOnWin, setSeqOnLoss, setEndBehavior, setLineText,
              setCycleTarget, setCycleStopLoss, setMaxCycles,
              setStopWin, setStopLoss, setAheadFactor, setBehindFactor,
            })
            if (!name.trim()) setName(p.name)
            if (!description.trim()) setDescription(p.description)
          }}
        >
          <option value="">— pick a starting point (optional) —</option>
          {PRESETS.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.description}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Style
        <select value={mode} onChange={e => setMode(e.target.value as Mode)}>
          <option value="progression">Progression (transform the stake on win/loss)</option>
          <option value="sequence">Betting ladder (fixed sequence of stakes)</option>
          <option value="cancellation">Cancellation line (Labouchere-style)</option>
          <option value="steps">Step machine (custom stakes with win/loss jumps)</option>
        </select>
      </label>

      {mode === 'progression' && (
        <>
          <div className="field-row">
            <label className="field">
              Starting stake ({amtLabel})
              <AmountInput value={start} min={0.1} onChange={setStart} />
            </label>
            <span className="field muted">
              = {both(start)}
            </span>
            <label className="field">
              Reset after N straight wins (0 = never)
              <input
                type="number"
                min={0}
                max={20}
                value={winStreakReset}
                onChange={e => setWinStreakReset(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
          <StepActionEditor label="After a WIN" action={onWin} onChange={setOnWin} />
          <StepActionEditor label="After a LOSS" action={onLoss} onChange={setOnLoss} />
          <div className="muted hint">
            Examples — Martingale: loss ×2, win reset · D'Alembert: loss +1, win −1 ·
            Paroli: win ×2 with reset after 3 wins, loss reset.
          </div>
        </>
      )}

      {mode === 'sequence' && (
        <>
          <label className="field">
            Stake sequence (units, comma-separated)
            <input value={seqText} onChange={e => setSeqText(e.target.value)} placeholder="1, 3, 2, 6" />
          </label>
          <div className="muted hint">
            In dollars: {parseNumberList(seqText).map(v => dollars(v)).join(' → ') || '—'}
          </div>
          <SeqActionEditor label="After a WIN" action={seqOnWin} onChange={setSeqOnWin} />
          <SeqActionEditor label="After a LOSS" action={seqOnLoss} onChange={setSeqOnLoss} />
          <label className="field">
            At the end of the sequence
            <select
              value={endBehavior}
              onChange={e => setEndBehavior(e.target.value as 'clamp' | 'reset')}
            >
              <option value="reset">Restart from the beginning</option>
              <option value="clamp">Stay on the last stake</option>
            </select>
          </label>
          <div className="muted hint">
            Examples — 1-3-2-6: win forward 1 (restart at end), loss back to start ·
            Fibonacci: sequence 1,1,2,3,5,8,13,21 with loss forward 1, win back 2.
          </div>
        </>
      )}

      {mode === 'steps' && (
        <>
          <div className="rules-header">
            <span className="stat-title">Stake steps (starts on Step 1)</span>
            <button
              className="btn btn-small"
              onClick={() => setMoneySteps(ss => [...ss, { mult: 1, onWin: 'stay', onLoss: 'stay' }])}
            >
              + Add step
            </button>
          </div>
          {moneySteps.map((s, i) => {
            const jumpSelect = (value: number | 'stay', onChange: (v: number | 'stay') => void) => (
              <select
                value={value === 'stay' ? 'stay' : String(value)}
                onChange={e => onChange(e.target.value === 'stay' ? 'stay' : Number(e.target.value))}
              >
                <option value="stay">Stay here</option>
                {moneySteps.map((_, j) => (
                  <option key={j} value={j}>
                    Go to Step {j + 1}
                  </option>
                ))}
              </select>
            )
            return (
              <div className="field-row transition-row" key={i}>
                <span className="rule-index">Step {i + 1}</span>
                <label className="field">
                  Stake ({amtLabel})
                  <AmountInput
                    value={s.mult}
                    min={0.1}
                    onChange={mult =>
                      setMoneySteps(ss => ss.map((x, j) => (j === i ? { ...x, mult } : x)))
                    }
                  />
                </label>
                <span className="field muted">= {both(s.mult)}</span>
                <label className="field">
                  On win
                  {jumpSelect(s.onWin, v =>
                    setMoneySteps(ss => ss.map((x, j) => (j === i ? { ...x, onWin: v } : x))),
                  )}
                </label>
                <label className="field">
                  On loss
                  {jumpSelect(s.onLoss, v =>
                    setMoneySteps(ss => ss.map((x, j) => (j === i ? { ...x, onLoss: v } : x))),
                  )}
                </label>
                {moneySteps.length > 1 && (
                  <button
                    className="link danger"
                    onClick={() =>
                      setMoneySteps(ss =>
                        ss
                          .filter((_, j) => j !== i)
                          .map(x => ({
                            ...x,
                            onWin: x.onWin === 'stay' ? 'stay' : x.onWin === i ? 0 : x.onWin > i ? x.onWin - 1 : x.onWin,
                            onLoss: x.onLoss === 'stay' ? 'stay' : x.onLoss === i ? 0 : x.onLoss > i ? x.onLoss - 1 : x.onLoss,
                          })),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            )
          })}
          <div className="muted hint">
            Fully free-form: e.g. Step 1 stakes 1 unit and jumps to Step 2 on a loss;
            Step 2 stakes 3 units, back to Step 1 on a win, on to Step 3 on a loss…
          </div>
        </>
      )}

      {mode === 'cancellation' && (
        <>
          <label className="field">
            Starting line (units, comma-separated)
            <input value={lineText} onChange={e => setLineText(e.target.value)} placeholder="1, 2, 3, 4" />
          </label>
          <div className="muted hint">
            In dollars: {parseNumberList(lineText).map(v => dollars(v)).join(' · ') || '—'} ·
            opening stake {both(
              parseNumberList(lineText).length > 1
                ? parseNumberList(lineText)[0] + parseNumberList(lineText)[parseNumberList(lineText).length - 1]
                : parseNumberList(lineText)[0] ?? 0,
            )}
          </div>
          <div className="muted hint">
            Stake = first + last number of the line. Win crosses both off; loss appends
            the lost stake. Completing the line restarts it.
          </div>
        </>
      )}

      <div className="rules-header">
        <span className="stat-title">Bank &amp; reset cycles — climb, take the profit, start over</span>
      </div>
      <div className="field-row">
        <label className="field">
          Reset to opening stake at cycle profit ≥ ({amtLabel}, 0 = off)
          <AmountInput value={cycleTarget} min={0} step={1} onChange={setCycleTarget} />
        </label>
        <label className="field">
          Abandon cycle at loss ≤ − ({amtLabel}, 0 = off)
          <AmountInput value={cycleStopLoss} min={0} step={1} onChange={setCycleStopLoss} />
        </label>
        <label className="field">
          Stop after N cycles (0 = endless)
          <input
            type="number"
            min={0}
            step={1}
            value={maxCycles}
            onChange={e => setMaxCycles(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>
      {cycleTarget > 0 && (
        <>
          <label className="field">
            When a cycle overshoots its target
            <select
              value={cycleBasis}
              onChange={e => setCycleBasis(e.target.value as 'milestones' | 'from-cycle-start')}
            >
              <option value="milestones">
                Keep fixed milestones — overshoot counts toward the next target
              </option>
              <option value="from-cycle-start">
                Carry the overshoot — each cycle needs a full target again
              </option>
            </select>
          </label>
          <div className="muted hint">
            Each cycle aims for <strong>{both(cycleTarget)}</strong> of profit; on reaching
            it the staking plan snaps back to its opening stake and the next cycle starts.
            {cycleBasis === 'milestones' ? (
              <>
                {' '}Targets stay pinned at {both(cycleTarget)}, {both(cycleTarget * 2)},{' '}
                {both(cycleTarget * 3)}… so overshooting to {both(cycleTarget * 1.5)} still
                leaves {both(cycleTarget * 2)} as the next goal.
              </>
            ) : (
              <>
                {' '}Overshoot is carried: finishing a cycle at {both(cycleTarget * 1.5)}{' '}
                makes the next goal {both(cycleTarget * 2.5)} — a full {both(cycleTarget)}{' '}
                from where you stand.
              </>
            )}
          </div>
        </>
      )}

      <div className="rules-header">
        <span className="stat-title">Session guards — react to your running profit (any style)</span>
      </div>
      <div className="field-row">
        <label className="field">
          Walk away at profit ≥ ({amtLabel}, 0 = never)
          <AmountInput value={stopWin} min={0} step={1} onChange={setStopWin} />
        </label>
        <label className="field">
          Stop loss at ≤ − ({amtLabel}, 0 = never)
          <AmountInput value={stopLoss} min={0} step={1} onChange={setStopLoss} />
        </label>
        <label className="field">
          While in profit, stake ×
          <input
            type="number"
            min={0.1}
            step={0.25}
            value={aheadFactor}
            onChange={e => setAheadFactor(Math.max(0.1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="field">
          While behind, stake ×
          <input
            type="number"
            min={0.1}
            step={0.25}
            value={behindFactor}
            onChange={e => setBehindFactor(Math.max(0.1, Number(e.target.value) || 1))}
          />
        </label>
      </div>
      <div className="muted hint">
        Once a walk-away threshold is hit, the system stops betting for the rest of the
        session (stake 0, banked). The × factors let you press with house money
        (in profit × 2) or protect the bankroll while behind (× 0.5). Profit is tracked
        per combo inside the simulation.
        {(stopWin > 0 || stopLoss > 0) && (
          <>
            {' '}Thresholds: {stopWin > 0 ? `walk away at ${both(stopWin)} profit` : 'no win target'} ·{' '}
            {stopLoss > 0 ? `stop loss at ${both(-stopLoss)}` : 'no stop loss'}.
          </>
        )}
      </div>

      <div className="builder-preview">
        <span className="stat-title">Live preview vs this session (on Always Red)</span>
        {preview === null ? (
          <span className="muted">Record spins in the tracker to preview performance.</span>
        ) : (() => {
          // Convert the simulation's dollars back into units for display so the
          // preview honours the units/dollars toggle like the rest of the form.
          const u = (money: number) => money / session.config.baseUnit
          const staked = u(preview.totalStaked)
          const netU = u(preview.profit)
          return (
            <div className="preview-line">
              <span className={preview.profit >= 0 ? 'pos' : 'neg'}>net {fmtNet(netU)}</span>
              <span className="muted">gross returned {fmtAmt(staked + netU)}</span>
              <span>{preview.wins}W-{preview.losses}L</span>
              <span className="muted">total staked {fmtAmt(staked)}</span>
              <span className="muted">peak stake {fmtAmt(u(preview.peakStake))}</span>
              <span className="muted">max drawdown {fmtAmt(u(preview.maxDrawdown))}</span>
              {preview.sitOuts > 0 && (
                <span className="muted">{preview.sitOuts} sat out (walked away / no bet)</span>
              )}
              {preview.busted && <span className="neg">BUSTED</span>}
            </div>
          )
        })()}
      </div>
      {problems.length > 0 && <div className="builder-problems">{problems.join(' ')}</div>}
    </div>
  )
}
