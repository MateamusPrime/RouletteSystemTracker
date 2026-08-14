import { useMemo } from 'react'
import {
  FIXED_BET_INFO,
  comboLabel,
  comboPayout,
  placedUnits,
  stepOutcomes,
} from '../../domain/custom/stepInterpreter'
import type { StepOutcome } from '../../domain/custom/stepInterpreter'
import type {
  MartiPlacementDef,
  AnyPlacementDef,
  ConditionDef,
  MoneyDef,
  StepDef,
  StepNext,
  StepPlacementDef,
  PlacementDef,
  TargetDef,
} from '../../domain/custom/types'
import { isGbPlacement, isMartiPlacement, isStepPlacement } from '../../domain/custom/types'
import { describeTrigger, legInfo } from '../../domain/custom/gbInterpreter'
import { martiLegs } from '../../domain/custom/martiInterpreter'
import { labelOf } from '../../domain/roulette'
import { BoardEditor } from '../builder/BoardEditor'

export type ReportTarget =
  | { kind: 'placement'; def: AnyPlacementDef }
  | { kind: 'money'; def: MoneyDef }

interface Props {
  target: ReportTarget
  onClose(): void
}

const noop = () => {}

function targetText(t: TargetDef): string {
  switch (t.kind) {
    case 'fixed':
      return FIXED_BET_INFO[t.bet].label
    case 'numbers':
      return `straight-up on ${t.numbers.map(labelOf).join(', ')}`
    case 'hotGroup':
      return `${t.rank === 2 ? '2nd hottest' : 'hottest'} ${t.group} of the last ${t.window} spins`
    case 'coldGroup':
      return `coldest ${t.group} of the last ${t.window} spins`
    case 'hotNumbers':
      return `${t.count} hottest numbers of the last ${t.window} spins`
    case 'coldNumbers':
      return `${t.count} coldest numbers of the last ${t.window} spins`
    case 'lastColor':
      return 'the color that just hit'
    case 'oppositeLastColor':
      return 'the opposite of the color that just hit'
    case 'lastDozen':
      return 'the dozen that just hit'
    case 'lastColumn':
      return 'the column that just hit'
    case 'neighbours':
      return `the last number ± ${t.span} physical wheel neighbours`
    case 'repeatLast':
      return 'a repeat of the last number'
  }
}

function conditionText(c: ConditionDef): string {
  switch (c.kind) {
    case 'always':
      return 'every spin'
    case 'streak':
      return `after ${c.length}+ spins of the same ${c.group === 'oddEven' ? 'odd/even' : c.group === 'highLow' ? 'high/low' : c.group}`
    case 'targetSleeping':
      return `only when the target has not hit for ${c.gap}+ spins`
    case 'targetHitting':
      return `only when the target hit ${c.minHits}+ times in the last ${c.window} spins`
  }
}

export function SystemReport({ target, onClose }: Props) {
  const isSteps = target.kind === 'placement' && isStepPlacement(target.def)
  const stepDef = isSteps ? (target.def as StepPlacementDef) : null
  const previewUnit =
    (target.kind === 'money' ? target.def.previewUnit : stepDef?.previewUnit) ?? 5
  const dollars = (u: number) =>
    `${u < 0 ? '-' : ''}$${parseFloat(Math.abs(u * previewUnit).toFixed(2))}`
  const both = (u: number) =>
    `${u < 0 ? '-' : ''}${parseFloat(Math.abs(u).toFixed(2))}u (${dollars(u)})`
  const netBoth = (u: number) => `${u > 0 ? '+' : ''}${both(u)}`

  const generatedOn = useMemo(() => new Date().toLocaleString(), [])

  const destName = (steps: StepDef[], d: StepNext) =>
    d === 'restart' ? 'Restart (Step 1)' : `Go to ${steps[d]?.name || `Step ${d + 1}`}`

  const renderStepSystem = (def: StepPlacementDef) => (
    <>
      {def.steps.map((step, i) => {
        const outcomes = stepOutcomes(step)
        const rows: { label: string; dest: string; net: number; gross: number; override: boolean }[] = []
        for (let k = 0; k <= step.bets.length; k++) {
          const atK = outcomes.filter(o => o.hits === k)
          if (atK.length === 0) continue
          const distinct = (vals: number[]) => [...new Set(vals)]
          if (atK.length === 1 || distinct(atK.map(o => o.net)).length === 1) {
            const withOverride = atK.filter(o => step.outcomeNext?.[o.key] !== undefined)
            rows.push({
              label: `${k} of ${step.bets.length} bets win${k === 0 ? ' (all miss)' : k === step.bets.length ? ' (all hit)' : ''}`,
              dest: destName(def.steps, step.next[Math.min(k, step.next.length - 1)] ?? 'restart'),
              net: atK[0].net,
              gross: atK[0].gross,
              override: false,
            })
            for (const o of withOverride) {
              rows.push({
                label: `↳ when ${o.winners.join(' + ')} win${o.winners.length === 1 ? 's' : ''}`,
                dest: destName(def.steps, step.outcomeNext![o.key]),
                net: o.net,
                gross: o.gross,
                override: true,
              })
            }
          } else {
            rows.push({
              label: `${k} of ${step.bets.length} bets win`,
              dest: destName(def.steps, step.next[Math.min(k, step.next.length - 1)] ?? 'restart'),
              net: NaN,
              gross: NaN,
              override: false,
            })
            for (const o of atK) {
              const ov = step.outcomeNext?.[o.key]
              rows.push({
                label: `↳ ${o.winners.join(' + ')} win${o.winners.length === 1 ? 's' : ''}`,
                dest: ov !== undefined ? destName(def.steps, ov) : '(rule above)',
                net: o.net,
                gross: o.gross,
                override: ov !== undefined,
              })
            }
          }
        }
        const carry = step.funding.type === 'carry' ? step.funding : null
        return (
          <section className="report-step" key={i}>
            <h2>
              <span className="step-no">Step {i + 1}</span> {step.name || `Step ${i + 1}`}
              {i === 0 && <span className="tag">START</span>}
            </h2>
            <div className="report-board">
              <BoardEditor
                bets={step.bets}
                onToggleOutside={noop}
                onToggleNumber={noop}
                onToggleCombo={noop}
                formatAmount={u => String(parseFloat(u.toFixed(2)))}
              />
            </div>
            <div className="report-cols">
              <div>
                <h3>Bets ({step.bets.length})</h3>
                <table>
                  <thead>
                    <tr><th>Bet</th><th>Stake</th></tr>
                  </thead>
                  <tbody>
                    {step.bets.map((b, bi) => (
                      <tr key={bi}>
                        <td>
                          {b.target.kind === 'fixed'
                            ? FIXED_BET_INFO[b.target.bet].label
                            : b.target.kind === 'combo'
                              ? `${comboLabel(b.target.numbers)} (${comboPayout(b.target.numbers.length)}:1)`
                              : `${b.target.numbers.length} straight numbers (${b.target.numbers.map(labelOf).join(', ')})`}
                        </td>
                        <td>
                          {both(b.units)}
                          {b.target.kind === 'numbers' ? ' per number' : ''}
                        </td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td>Total on the felt</td>
                      <td>{both(placedUnits(step))}</td>
                    </tr>
                  </tbody>
                </table>
                <h3>Funding</h3>
                {carry ? (
                  <p>
                    Carries the previous step's{' '}
                    <strong>{(carry.basis ?? 'net') === 'gross' ? 'gross return' : 'net win'}</strong>
                    {carry.plannedWin !== undefined && <> (planned {both(carry.plannedWin)})</>},
                    pockets <strong>{both(carry.pocketUnits)}</strong> first, and spreads the
                    rest across the bets above. Nothing left → restart.
                  </p>
                ) : (
                  <p>Fixed stakes as listed above.</p>
                )}
              </div>
              <div>
                <h3>After the spin</h3>
                <table>
                  <thead>
                    <tr><th>Outcome</th><th>Net</th><th>Gross</th><th>Then</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri} className={r.override ? 'override-row' : r.label.startsWith('↳') ? 'sub-row' : ''}>
                        <td>{r.label}</td>
                        <td>{Number.isNaN(r.net) ? 'varies' : netBoth(r.net)}</td>
                        <td>{Number.isNaN(r.gross) ? 'varies' : both(r.gross)}</td>
                        <td>{r.dest}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )
      })}
    </>
  )

  const renderRulesSystem = (def: PlacementDef) => (
    <section className="report-step">
      <h2>Bet rules</h2>
      {def.minSpins > 0 && <p>Sits out until {def.minSpins} spins are recorded.</p>}
      <table>
        <thead>
          <tr><th>#</th><th>Bets on</th><th>When</th><th>Units</th></tr>
        </thead>
        <tbody>
          {def.rules.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{targetText(r.target)}</td>
              <td>{conditionText(r.condition)}</td>
              <td>{r.units}u</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )

  /** Shared table for the leg-based systems (GB and Marti GB). */
  const renderLegSystem = (
    legs: { label: string; trigger: string; units: number }[],
    extra?: React.ReactNode,
  ) => (
    <section className="report-step">
      <h2>Legs</h2>
      <p>
        Each leg runs as an independent bet with its own money-management
        progression, while all of them draw on the same bankroll.
      </p>
      {extra}
      <table>
        <thead>
          <tr>
            <th>Leg</th>
            <th>Starts betting</th>
            <th>Stake</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((l, i) => (
            <tr key={i}>
              <td>{l.label}</td>
              <td>{l.trigger}</td>
              <td>{both(l.units)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )

  const renderMartiSystem = (def: MartiPlacementDef) =>
    renderLegSystem(
      martiLegs(def).map(l => ({
        label: `${l.label} (${l.family})`,
        trigger: 'start of each round',
        units: def.units,
      })),
      <table>
        <tbody>
          <tr>
            <td>Anchor number</td>
            <td>{def.anchor}</td>
          </tr>
          <tr>
            <td>Round rule</td>
            <td>
              A leg that wins stands down until every leg has won; then the round
              restarts with all legs back on the opening bet.
            </td>
          </tr>
          <tr>
            <td>Progressions between rounds</td>
            <td>{def.resetEachRound ? 'reset to the opening stake' : 'carry over'}</td>
          </tr>
        </tbody>
      </table>,
    )

  const renderMoneySystem = (def: MoneyDef) => (
    <section className="report-step">
      <h2>Staking plan</h2>
      <p className="report-desc">1 unit = {dollars(1)} — stakes are shown in both.</p>
      {def.mode === 'progression' && (
        <table>
          <tbody>
            <tr><td>Style</td><td>Progression</td></tr>
            <tr><td>Starting stake</td><td>{both(def.start)}</td></tr>
            <tr><td>After a win</td><td>{def.onWin.op}{def.onWin.op !== 'reset' && def.onWin.op !== 'hold' ? ` ${def.onWin.value}` : ''}</td></tr>
            <tr><td>After a loss</td><td>{def.onLoss.op}{def.onLoss.op !== 'reset' && def.onLoss.op !== 'hold' ? ` ${def.onLoss.value}` : ''}</td></tr>
            <tr><td>Reset after win streak</td><td>{def.winStreakReset > 0 ? `${def.winStreakReset} wins` : 'never'}</td></tr>
            <tr className="total-row"><td>Stake cap</td><td>{both(def.cap)}</td></tr>
          </tbody>
        </table>
      )}
      {def.mode === 'sequence' && (
        <table>
          <tbody>
            <tr><td>Style</td><td>Betting ladder</td></tr>
            <tr><td>Sequence (units)</td><td>{def.sequence.join(' → ')}</td></tr>
            <tr><td>Sequence ($)</td><td>{def.sequence.map(v => dollars(v)).join(' → ')}</td></tr>
            <tr><td>After a win</td><td>{def.onWin.op}{def.onWin.op === 'forward' || def.onWin.op === 'back' ? ` ${def.onWin.steps}` : ''}</td></tr>
            <tr><td>After a loss</td><td>{def.onLoss.op}{def.onLoss.op === 'forward' || def.onLoss.op === 'back' ? ` ${def.onLoss.steps}` : ''}</td></tr>
            <tr><td>At the end</td><td>{def.endBehavior === 'reset' ? 'restart the ladder' : 'stay on the last stake'}</td></tr>
            <tr className="total-row"><td>Stake cap</td><td>{both(def.cap)}</td></tr>
          </tbody>
        </table>
      )}
      {def.mode === 'cancellation' && (
        <table>
          <tbody>
            <tr><td>Style</td><td>Cancellation line (Labouchere)</td></tr>
            <tr><td>Starting line (units)</td><td>{def.line.join(' · ')}</td></tr>
            <tr><td>Starting line ($)</td><td>{def.line.map(v => dollars(v)).join(' · ')}</td></tr>
            <tr>
              <td>Opening stake</td>
              <td>
                {both(def.line.length > 1 ? def.line[0] + def.line[def.line.length - 1] : def.line[0] ?? 0)}
              </td>
            </tr>
            <tr className="total-row"><td>Stake cap</td><td>{both(def.cap)}</td></tr>
          </tbody>
        </table>
      )}
      {def.mode === 'steps' && (
        <table>
          <thead>
            <tr><th>Step</th><th>Stake</th><th>On win</th><th>On loss</th></tr>
          </thead>
          <tbody>
            {def.steps.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{both(s.mult)}</td>
                <td>{s.onWin === 'stay' ? 'stay' : `go to step ${s.onWin + 1}`}</td>
                <td>{s.onLoss === 'stay' ? 'stay' : `go to step ${s.onLoss + 1}`}</td>
              </tr>
            ))}
            <tr className="total-row"><td>Stake cap</td><td colSpan={3}>{both(def.cap)}</td></tr>
          </tbody>
        </table>
      )}
      {def.guards &&
        (def.guards.stopWinUnits || def.guards.stopLossUnits ||
          def.guards.cycleTargetUnits || def.guards.cycleStopLossUnits ||
          def.guards.maxCycles ||
          def.guards.aheadFactor !== 1 || def.guards.behindFactor !== 1) && (
          <>
            <h3>Session guards &amp; cycles</h3>
            <table>
              <tbody>
                {def.guards.stopWinUnits != null && def.guards.stopWinUnits > 0 && (
                  <tr><td>Walk away at profit</td><td>≥ {both(def.guards.stopWinUnits)}</td></tr>
                )}
                {def.guards.stopLossUnits != null && def.guards.stopLossUnits > 0 && (
                  <tr><td>Stop loss at</td><td>≤ {both(-def.guards.stopLossUnits)}</td></tr>
                )}
                {def.guards.cycleTargetUnits != null && def.guards.cycleTargetUnits > 0 && (
                  <tr>
                    <td>Bank &amp; reset cycle at</td>
                    <td>+{both(def.guards.cycleTargetUnits)} profit per cycle</td>
                  </tr>
                )}
                {def.guards.cycleStopLossUnits != null && def.guards.cycleStopLossUnits > 0 && (
                  <tr>
                    <td>Abandon cycle at</td>
                    <td>{both(-def.guards.cycleStopLossUnits)} per cycle</td>
                  </tr>
                )}
                {def.guards.maxCycles != null && def.guards.maxCycles > 0 && (
                  <tr><td>Stop after</td><td>{def.guards.maxCycles} completed cycles</td></tr>
                )}
                {def.guards.aheadFactor !== 1 && (
                  <tr><td>While in profit</td><td>stake × {def.guards.aheadFactor}</td></tr>
                )}
                {def.guards.behindFactor !== 1 && (
                  <tr><td>While behind</td><td>stake × {def.guards.behindFactor}</td></tr>
                )}
              </tbody>
            </table>
            <p>
              Once a walk-away threshold is reached the system stops betting for the
              remainder of the session (stake 0, winnings banked).
            </p>
          </>
        )}
    </section>
  )

  const def = target.def

  return (
    <div className="system-report">
      <div className="report-toolbar no-print">
        <button className="btn" onClick={onClose}>← Back to app</button>
        <span className="muted">
          Tip: in the print dialog, turn OFF "Headers and footers" and keep
          "Background graphics" ON for the cleanest PDF.
        </span>
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <header className="report-header">
        <div className="report-brand">◉ Roulette System Tracker</div>
        <h1>{def.name}</h1>
        <div className="report-subtitle">
          {target.kind === 'money'
            ? `Money management system · ${target.def.mode} · 1 unit = ${dollars(1)}`
            : isSteps
              ? `Step placement system · ${(def as StepPlacementDef).steps.length} steps · 1 unit = ${dollars(1)}`
              : 'Rules-based placement system'}
        </div>
        {def.description && <p className="report-desc">{def.description}</p>}
      </header>

      {target.kind === 'money'
        ? renderMoneySystem(target.def)
        : isStepPlacement(target.def)
          ? renderStepSystem(target.def)
          : isGbPlacement(target.def)
            ? renderLegSystem(target.def.legs.map(l => ({
                label: legInfo(l).label,
                trigger: describeTrigger(l.trigger),
                units: l.units,
              })))
            : isMartiPlacement(target.def)
              ? renderMartiSystem(target.def)
              : renderRulesSystem(target.def)}

      <footer className="report-footer">
        Generated {generatedOn} · Roulette System Tracker ·
        Roulette outcomes are independent; no system changes the house edge. Play responsibly.
      </footer>
    </div>
  )
}

export type { StepOutcome }
