import { Fragment, useMemo, useState } from 'react'
import {
  FIXED_BET_INFO,
  buildStepPlacementSystem,
  comboLabel,
  comboPayout,
  currentStepState,
  describeStepBets,
  placedUnits,
  stepOutcomes,
} from '../../domain/custom/stepInterpreter'
import type { StepOutcome } from '../../domain/custom/stepInterpreter'
import type {
  FixedBetKind,
  StepBetDef,
  StepDef,
  StepNext,
  StepPlacementDef,
} from '../../domain/custom/types'
import { flat } from '../../domain/money/systems'
import { labelOf } from '../../domain/roulette'
import { simulateCombo } from '../../domain/simulation'
import type { Session } from '../../domain/types'
import { BoardEditor } from './BoardEditor'

interface Props {
  initial: StepPlacementDef | null
  session: Session
  onSave(def: StepPlacementDef): void
  onCancel(): void
}

function newStep(index: number): StepDef {
  return {
    name: `Step ${index + 1}`,
    bets: [],
    funding: { type: 'fixed' },
    next: ['restart'],
  }
}

/** Keeps next[] sized to bets.length + 1, preserving existing choices. */
function resizeNext(next: StepNext[], betCount: number): StepNext[] {
  const out: StepNext[] = []
  for (let k = 0; k <= betCount; k++) out.push(next[k] ?? 'restart')
  return out
}

function numbersBet(step: StepDef): StepBetDef | undefined {
  return step.bets.find(b => b.target.kind === 'numbers')
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

const ALLOC_TOLERANCE = 0.05

interface CarryInfo {
  planned: number
  pocket: number
  toPlace: number
  placed: number
  /** Positive = units still unplaced; negative = overplaced. */
  unplaced: number
}

/** Budget accounting for a carry-funded step. */
function carryInfo(step: StepDef): CarryInfo | null {
  if (step.funding.type !== 'carry') return null
  const placed = round2(placedUnits(step))
  const pocket = step.funding.pocketUnits
  const planned = step.funding.plannedWin ?? round2(pocket + placed)
  const toPlace = round2(planned - pocket)
  return { planned, pocket, toPlace, placed, unplaced: round2(toPlace - placed) }
}

interface InboundEdge {
  from: string
  hits: number
  total: number
  /** The distinct winning combinations this route can arrive with. */
  outcomes: StepOutcome[]
}

/** Where a specific outcome of step `s` routes: outcome override, else hit-count rule. */
function outcomeDest(s: StepDef, o: StepOutcome): StepNext {
  return s.outcomeNext?.[o.key] ?? s.next[Math.min(o.hits, s.next.length - 1)] ?? 'restart'
}

/** Every outcome in the system that leads INTO step `target`, grouped by route. */
function inboundEdges(steps: StepDef[], target: number): InboundEdge[] {
  const grouped = new Map<string, InboundEdge>()
  steps.forEach((s, si) => {
    for (const o of stepOutcomes(s)) {
      if (outcomeDest(s, o) !== target) continue
      const gk = `${si}:${o.hits}`
      const edge = grouped.get(gk) ?? {
        from: s.name || `Step ${si + 1}`,
        hits: o.hits,
        total: s.bets.length,
        outcomes: [],
      }
      edge.outcomes.push(o)
      grouped.set(gk, edge)
    }
  })
  return [...grouped.values()]
}

function basisValue(o: StepOutcome, basis: 'net' | 'gross'): number {
  return basis === 'gross' ? o.gross : o.net
}

/** Best guess for a carry step's incoming win: the highest positive inbound value. */
function suggestedPlanned(
  steps: StepDef[],
  target: number,
  basis: 'net' | 'gross',
): number | undefined {
  const vals = inboundEdges(steps, target)
    .flatMap(e => e.outcomes)
    .map(o => basisValue(o, basis))
    .filter(v => v > 0)
  return vals.length > 0 ? Math.max(...vals) : undefined
}

function outcomeWho(o: StepOutcome): string {
  return o.winners.length === 0
    ? 'all miss'
    : `${o.winners.join(' + ')} win${o.winners.length === 1 ? 's' : ''}`
}

export function StepBuilder({ initial, session, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [steps, setSteps] = useState<StepDef[]>(initial?.steps ?? [newStep(0)])
  const [previewUnit, setPreviewUnit] = useState(
    initial?.previewUnit ?? session.config.baseUnit,
  )
  const [amountMode, setAmountMode] = useState<'units' | 'dollars'>('units')
  /** Which "by winning bet" drill-downs are open, keyed `${stepIdx}:${hitCount}`. */
  const [expandedOutcomes, setExpandedOutcomes] = useState<Set<string>>(new Set())

  const toggleOutcomes = (key: string) =>
    setExpandedOutcomes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /** "$5" for 1 unit at the current preview unit value. */
  const dollars = (units: number) => `$${parseFloat((units * previewUnit).toFixed(2))}`

  /** Formats an amount in the currently selected entry mode (units or dollars). */
  const fmtAmt = (v: number): string => {
    const neg = v < 0 ? '-' : ''
    if (amountMode === 'dollars') {
      return `${neg}$${parseFloat(Math.abs(v * previewUnit).toFixed(2))}`
    }
    return `${neg}${parseFloat(Math.abs(v).toFixed(2))}u`
  }
  const fmtNet = (v: number) => `${v > 0 ? '+' : ''}${fmtAmt(v)}`
  const fmtList = (vals: number[], signed: boolean) =>
    vals.map(v => (signed ? fmtNet(v) : fmtAmt(v))).join(' / ')

  const draft: StepPlacementDef = useMemo(
    () => ({
      variant: 'steps',
      id: initial?.id ?? `custom-s-${crypto.randomUUID()}`,
      name: name.trim() || 'Unnamed step system',
      description: description.trim(),
      steps,
      previewUnit,
    }),
    [initial?.id, name, description, steps, previewUnit],
  )

  const preview = useMemo(() => {
    if (session.spins.length === 0) return null
    return simulateCombo(buildStepPlacementSystem(draft), flat, session.spins, session.config)
  }, [draft, session])

  const liveState = useMemo(
    () => (session.spins.length > 0 ? currentStepState(draft, session.spins) : null),
    [draft, session.spins],
  )

  const problems: string[] = []
  if (!name.trim()) problems.push('Give the system a name.')
  if (steps.length === 0) problems.push('Add at least one step.')
  steps.forEach((s, i) => {
    const label = s.name || `Step ${i + 1}`
    if (s.bets.length === 0) problems.push(`${label}: place at least one bet.`)
    const nb = numbersBet(s)
    if (nb && nb.target.kind === 'numbers' && nb.target.numbers.length === 0) {
      problems.push(`${label}: number spread is empty.`)
    }
    const info = carryInfo(s)
    if (info) {
      if (info.toPlace < 0) {
        problems.push(`${label}: pocket (${info.pocket}u) exceeds the incoming win (${info.planned}u).`)
      } else if (info.unplaced > ALLOC_TOLERANCE) {
        problems.push(`${label}: ${info.unplaced}u of the incoming win is neither pocketed nor placed.`)
      } else if (info.unplaced < -ALLOC_TOLERANCE) {
        problems.push(`${label}: ${Math.abs(info.unplaced)}u overplaced — more than the incoming win covers.`)
      }
    }
  })

  const updateStep = (i: number, step: StepDef) =>
    setSteps(ss => ss.map((s, j) => (j === i ? step : s)))

  const setBets = (i: number, bets: StepBetDef[]) => {
    setSteps(ss =>
      ss.map((s, j) => (j === i ? { ...s, bets, next: resizeNext(s.next, bets.length) } : s)),
    )
  }

  const toggleOutside = (i: number, kind: FixedBetKind) => {
    const step = steps[i]
    const existing = step.bets.findIndex(
      b => b.target.kind === 'fixed' && b.target.bet === kind,
    )
    if (existing >= 0) {
      setBets(i, step.bets.filter((_, j) => j !== existing))
      return
    }
    // On carry steps a new bet defaults to whatever budget is still unplaced.
    const info = carryInfo(step)
    const units = info && info.unplaced > 0 ? info.unplaced : 1
    setBets(i, [...step.bets, { target: { kind: 'fixed', bet: kind }, units }])
  }

  const toggleNumber = (i: number, n: number) => {
    const step = steps[i]
    const nb = numbersBet(step)
    const isCarry = step.funding.type === 'carry'
    if (!nb) {
      const info = carryInfo(step)
      const units = info && info.unplaced > 0 ? info.unplaced : 1
      setBets(i, [...step.bets, { target: { kind: 'numbers', numbers: [n] }, units }])
      return
    }
    if (nb.target.kind !== 'numbers') return
    const oldCount = nb.target.numbers.length
    const nums = nb.target.numbers.includes(n)
      ? nb.target.numbers.filter(x => x !== n)
      : [...nb.target.numbers, n].sort((a, b) => a - b)
    if (nums.length === 0) {
      setBets(i, step.bets.filter(b => b !== nb))
      return
    }
    // On carry steps the spread keeps its TOTAL budget: adding numbers splits
    // the same amount thinner, removing numbers concentrates it.
    const units = isCarry ? round2((nb.units * oldCount) / nums.length) : nb.units
    setBets(
      i,
      step.bets.map(b =>
        b === nb ? { ...b, units, target: { kind: 'numbers' as const, numbers: nums } } : b,
      ),
    )
  }

  const toggleCombo = (i: number, numbers: number[]) => {
    const step = steps[i]
    const key = numbers.join('-')
    const existing = step.bets.findIndex(
      b => b.target.kind === 'combo' && b.target.numbers.join('-') === key,
    )
    if (existing >= 0) {
      setBets(i, step.bets.filter((_, j) => j !== existing))
      return
    }
    const info = carryInfo(step)
    const units = info && info.unplaced > 0 ? info.unplaced : 1
    setBets(i, [...step.bets, { target: { kind: 'combo', numbers }, units }])
  }

  const splitEvenly = (i: number) => {
    const step = steps[i]
    const info = carryInfo(step)
    if (!info || step.bets.length === 0) return
    const share = info.toPlace / step.bets.length
    setBets(
      i,
      step.bets.map(b =>
        b.target.kind === 'numbers'
          ? { ...b, units: round2(share / b.target.numbers.length) }
          : { ...b, units: round2(share) },
      ),
    )
  }

  const removeStep = (i: number) => {
    setSteps(ss => {
      const remaining = ss.filter((_, j) => j !== i)
      // Remap transition pointers: removed step → restart, later steps shift down.
      const remap = (d: StepNext): StepNext => {
        if (d === 'restart' || d === i) return d === i ? 'restart' : d
        return d > i ? d - 1 : d
      }
      return remaining.map(s => ({
        ...s,
        next: s.next.map(remap),
        outcomeNext: s.outcomeNext
          ? Object.fromEntries(Object.entries(s.outcomeNext).map(([k, d]) => [k, remap(d)]))
          : undefined,
      }))
    })
  }

  return (
    <div className="builder-form">
      <div className="builder-form-header">
        <span className="panel-title">
          {initial ? `Edit: ${initial.name}` : 'New Step System'}
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
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Three-Way Ladder" />
        </label>
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
      </div>
      <div className="muted hint">
        Dollar figures are a preview (1u = {dollars(1)}) — the simulator always uses
        the session's unit size. Entering dollars converts to units under the hood.
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
        <span className="stat-title">
          Steps — the outcome of each spin decides which step's board is played next
        </span>
        <button className="btn btn-small" onClick={() => setSteps(ss => [...ss, newStep(ss.length)])}>
          + Add step
        </button>
      </div>

      {steps.map((step, i) => (
        <div className="rule-card" key={i}>
          <div className="rule-card-top">
            <span className="rule-index">
              Step {i + 1}
              {i === 0 && <span className="muted"> (start)</span>}
              {liveState && liveState.stepIdx === i && (
                <span className="live-step"> ● LIVE NOW</span>
              )}
            </span>
            <div className="saved-actions">
              <input
                className="step-name"
                value={step.name}
                onChange={e => updateStep(i, { ...step, name: e.target.value })}
                aria-label={`step ${i + 1} name`}
              />
              {steps.length > 1 && (
                <button className="link danger" onClick={() => removeStep(i)}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="stat-title">Board — click to place bets</div>
          <BoardEditor
            bets={step.bets}
            onToggleOutside={kind => toggleOutside(i, kind)}
            onToggleNumber={n => toggleNumber(i, n)}
            onToggleCombo={numbers => toggleCombo(i, numbers)}
            formatAmount={
              amountMode === 'dollars'
                ? u => dollars(u)
                : u => String(parseFloat(u.toFixed(2)))
            }
          />

          {step.bets.length > 0 && (
            <>
              <div className="stat-title">
                Bets on this board ({step.bets.length}) —{' '}
                {step.funding.type === 'carry' ? 'weights for splitting the carried winnings' : 'units staked'}
              </div>
              {step.bets.map((bet, bi) => {
                const perLabel = bet.target.kind === 'numbers' ? ' per number' : ''
                const applyUnits = (units: number) =>
                  setBets(i, step.bets.map((b, j) => (j === bi ? { ...b, units } : b)))
                return (
                <div className="field-row bet-line" key={bi}>
                  <span className="bet-line-label">
                    {bet.target.kind === 'fixed'
                      ? FIXED_BET_INFO[bet.target.bet].label
                      : bet.target.kind === 'combo'
                        ? `${comboLabel(bet.target.numbers)} (pays ${comboPayout(bet.target.numbers.length)}:1)`
                        : `${bet.target.numbers.length} straight numbers (${bet.target.numbers.map(labelOf).join(', ')})`}
                    <span className="muted">
                      {' '}— {parseFloat(bet.units.toFixed(2))}u{perLabel} ({dollars(bet.units)}{perLabel})
                    </span>
                  </span>
                  {amountMode === 'units' ? (
                    <label className="field">
                      Units{perLabel}
                      <input
                        type="number"
                        min={0.1}
                        step={0.5}
                        value={bet.units}
                        onChange={e => applyUnits(Math.max(0.1, Number(e.target.value) || 1))}
                      />
                    </label>
                  ) : (
                    <label className="field">
                      ${perLabel || ' amount'}
                      <input
                        type="number"
                        min={0.01}
                        step={1}
                        value={parseFloat((bet.units * previewUnit).toFixed(2))}
                        onChange={e =>
                          applyUnits(
                            Math.max(0.01, Number(e.target.value) || 1) / previewUnit,
                          )
                        }
                      />
                    </label>
                  )}
                </div>
                )
              })}
            </>
          )}

          <div className="field-row">
            <label className="field grow">
              Funding
              {i === 0 ? (
                <select value="fixed" disabled>
                  <option value="fixed">Fixed units (start step is always fixed)</option>
                </select>
              ) : (
                <select
                  value={step.funding.type}
                  onChange={e =>
                    updateStep(i, {
                      ...step,
                      funding:
                        e.target.value === 'carry'
                          ? {
                              type: 'carry',
                              pocketUnits: 0,
                              basis: 'gross',
                              plannedWin:
                                suggestedPlanned(steps, i, 'gross') ??
                                Math.max(round2(placedUnits(step)), 1),
                            }
                          : { type: 'fixed' },
                    })
                  }
                >
                  <option value="fixed">Fixed units</option>
                  <option value="carry">Carry winnings from previous step</option>
                </select>
              )}
            </label>
            {step.funding.type === 'carry' && (() => {
              const carry = step.funding
              const basis = carry.basis ?? 'net'
              return (
              <>
                <label className="field">
                  Carry basis
                  <select
                    value={basis}
                    onChange={e =>
                      updateStep(i, {
                        ...step,
                        funding: { ...carry, basis: e.target.value as 'net' | 'gross' },
                      })
                    }
                  >
                    <option value="gross">Gross return (stakes back + winnings)</option>
                    <option value="net">Net win (profit only)</option>
                  </select>
                </label>
                <label className="field">
                  Incoming ({basis} units)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={carryInfo(step)?.planned ?? 0}
                    onChange={e =>
                      updateStep(i, {
                        ...step,
                        funding: { ...carry, plannedWin: Math.max(0, Number(e.target.value) || 0) },
                      })
                    }
                  />
                </label>
                <label className="field">
                  Pocket first (units)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={carry.pocketUnits}
                    onChange={e =>
                      updateStep(i, {
                        ...step,
                        funding: { ...carry, pocketUnits: Math.max(0, Number(e.target.value) || 0) },
                      })
                    }
                  />
                </label>
              </>
              )
            })()}
          </div>
          {step.funding.type === 'carry' && (() => {
            const carry = step.funding
            const basis = carry.basis ?? 'net'
            const info = carryInfo(step)!
            const edges = inboundEdges(steps, i)
            const options = edges.flatMap(e => e.outcomes.map(o => ({ edge: e, outcome: o })))
            return (
              <>
                <div className="muted hint">
                  Arrives here from:{' '}
                  {edges.length === 0
                    ? 'nowhere yet — pick this step in another step’s "After the spin" section.'
                    : edges
                        .map(e => {
                          const nets = [...new Set(e.outcomes.map(o => o.net))].sort((a, b) => a - b)
                          const gross = [...new Set(e.outcomes.map(o => o.gross))].sort((a, b) => a - b)
                          return `${e.from} with ${e.hits}/${e.total} hits (gross ${fmtList(gross, false) || '?'} · net ${fmtList(nets, true) || '?'})`
                        })
                        .join(' · ')}
                </div>
                {options.length > 0 && (
                  <label className="field">
                    Which bet wins? Pick the outcome to budget for — it sets the incoming amount
                    <select
                      value=""
                      onChange={e => {
                        const picked = options[Number(e.target.value)]
                        if (!picked) return
                        updateStep(i, {
                          ...step,
                          funding: { ...carry, plannedWin: basisValue(picked.outcome, basis) },
                        })
                      }}
                    >
                      <option value="">— select a winning outcome —</option>
                      {options.map((opt, j) => (
                        <option key={j} value={j}>
                          {opt.edge.from}: {outcomeWho(opt.outcome)} — gross {fmtAmt(opt.outcome.gross)} · net {fmtNet(opt.outcome.net)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className={`carry-account ${Math.abs(info.unplaced) > ALLOC_TOLERANCE || info.toPlace < 0 ? 'warn' : 'ok'}`}>
                  <span>Incoming <strong>{info.planned}u</strong> ({dollars(info.planned)}, {basis})</span>
                  <span>Pocket <strong>{info.pocket}u</strong> ({dollars(info.pocket)})</span>
                  <span>To place <strong>{info.toPlace}u</strong> ({dollars(info.toPlace)})</span>
                  <span>Placed <strong>{info.placed}u</strong> ({dollars(info.placed)})</span>
                  {info.unplaced > ALLOC_TOLERANCE && (
                    <span className="neg">{info.unplaced}u unplaced</span>
                  )}
                  {info.unplaced < -ALLOC_TOLERANCE && (
                    <span className="neg">{Math.abs(info.unplaced)}u overplaced</span>
                  )}
                  {Math.abs(info.unplaced) <= ALLOC_TOLERANCE && info.toPlace >= 0 && (
                    <span className="pos">fully allocated ✓</span>
                  )}
                  {step.bets.length > 0 && (
                    <button className="btn btn-small" onClick={() => splitEvenly(i)}>
                      Split evenly
                    </button>
                  )}
                </div>
                <div className="muted hint">
                  During simulation the actual winning bets are known for every spin —
                  this planned amount only guides your chip allocation. If the real
                  carried win differs, the same proportions are applied to it.
                </div>
              </>
            )
          })()}

          {step.bets.length > 0 && (
            <>
              <div className="stat-title">After the spin</div>
              {(() => {
                const outcomes = stepOutcomes(step)
                return Array.from({ length: step.bets.length + 1 }, (_, k) => {
                const atK = outcomes.filter(o => o.hits === k)
                // Mutually exclusive bets make some hit counts impossible
                // (e.g. two different dozens can never both win) — hide those.
                if (atK.length === 0) return null
                const nets = [...new Set(atK.map(o => o.net))].sort((a, b) => a - b)
                const gross = [...new Set(atK.map(o => o.gross))].sort((a, b) => a - b)
                const drillKey = `${i}:${k}`
                const drillOpen = expandedOutcomes.has(drillKey)
                const overrideCount = atK.filter(o => step.outcomeNext?.[o.key] !== undefined).length
                return (
                <Fragment key={k}>
                <div className="field-row transition-row">
                  <span className="bet-line-label">
                    If {k} of {step.bets.length} bet{step.bets.length === 1 ? '' : 's'} win
                    {k === 0 ? ' (all miss)' : k === step.bets.length ? ' (all hit)' : ''}
                    {atK.length > 0 && (
                      <span className="muted">
                        {' '}— net {fmtList(nets, true)}
                        {k > 0 && <> · gross {fmtList(gross, false)}</>}
                      </span>
                    )}
                    {atK.length > 1 && (
                      <>
                        {' '}
                        <button className="link drill-toggle" onClick={() => toggleOutcomes(drillKey)}>
                          {drillOpen ? '▾ by winning bet' : `▸ by winning bet (${atK.length}${overrideCount > 0 ? `, ${overrideCount} custom` : ''})`}
                        </button>
                      </>
                    )}
                  </span>
                  <select
                    value={step.next[k] === 'restart' ? 'restart' : String(step.next[k])}
                    onChange={e =>
                      updateStep(i, {
                        ...step,
                        next: step.next.map((d, j) =>
                          j === k
                            ? e.target.value === 'restart'
                              ? 'restart'
                              : Number(e.target.value)
                            : d,
                        ) as StepNext[],
                      })
                    }
                  >
                    <option value="restart">Restart (back to Step 1)</option>
                    {steps.map((s, si) => (
                      <option key={si} value={si}>
                        Go to {s.name || `Step ${si + 1}`} ({describeStepBets(s) || 'empty'})
                      </option>
                    ))}
                  </select>
                </div>
                {atK.length > 1 &&
                  drillOpen &&
                  atK.map(o => {
                    const override = step.outcomeNext?.[o.key]
                    return (
                      <div className="field-row transition-row outcome-row" key={o.key}>
                        <span className="bet-line-label muted">
                          ↳ if it's {o.winners.join(' + ')} that win{o.winners.length === 1 ? 's' : ''} — net{' '}
                          {fmtNet(o.net)} · gross {fmtAmt(o.gross)}
                        </span>
                        <select
                          value={override === undefined ? 'default' : override === 'restart' ? 'restart' : String(override)}
                          onChange={e => {
                            const v = e.target.value
                            const outcomeNext = { ...(step.outcomeNext ?? {}) }
                            if (v === 'default') delete outcomeNext[o.key]
                            else outcomeNext[o.key] = v === 'restart' ? 'restart' : Number(v)
                            updateStep(i, { ...step, outcomeNext })
                          }}
                        >
                          <option value="default">Use rule above</option>
                          <option value="restart">Restart (back to Step 1)</option>
                          {steps.map((s, si) => (
                            <option key={si} value={si}>
                              Go to {s.name || `Step ${si + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </Fragment>
                )
                })
              })()}
            </>
          )}
        </div>
      ))}

      <div className="add-step-bottom">
        <button className="btn" onClick={() => setSteps(ss => [...ss, newStep(ss.length)])}>
          + Add step
        </button>
      </div>

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
            {liveState && (
              <span>
                currently on{' '}
                <strong>{steps[liveState.stepIdx]?.name || `Step ${liveState.stepIdx + 1}`}</strong>
                {liveState.carryBudget !== null &&
                  ` (carrying ${liveState.carryBudget.toFixed(1)} units)`}
              </span>
            )}
            <span className="muted">
              Next spin:{' '}
              {preview.nextBets.length === 0
                ? 'sits out'
                : preview.nextBets.map(b => `$${b.amount.toFixed(2)} ${b.label}`).join(' · ')}
            </span>
          </div>
        )}
      </div>
      {problems.length > 0 && <div className="builder-problems">{problems.join(' ')}</div>}
    </div>
  )
}
