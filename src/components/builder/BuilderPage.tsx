import { useState } from 'react'
import type {
  AnyPlacementDef,
  CustomSystems,
  GbPlacementDef,
  MoneyDef,
  PlacementDef,
  StepPlacementDef,
} from '../../domain/custom/types'
import type { MartiPlacementDef } from '../../domain/custom/types'
import { isGbPlacement, isMartiPlacement, isStepPlacement } from '../../domain/custom/types'
import { GbBuilder } from './GbBuilder'
import { MartiBuilder } from './MartiBuilder'
import type { Session } from '../../domain/types'
import { MoneyBuilder } from './MoneyBuilder'
import { PlacementBuilder } from './PlacementBuilder'
import { StepBuilder } from './StepBuilder'

import type { ReportTarget } from '../report/SystemReport'
import type { SharedSystem } from '../../storage/shareLink'

interface Props {
  customs: CustomSystems
  session: Session
  onChange(customs: CustomSystems): void
  onExport(target: ReportTarget): void
  onShare(system: SharedSystem): void
}

type Editor =
  | { type: 'placement'; def: PlacementDef | null }
  | { type: 'steps'; def: StepPlacementDef | null }
  | { type: 'gb'; def: GbPlacementDef | null }
  | { type: 'marti'; def: MartiPlacementDef | null }
  | { type: 'money'; def: MoneyDef | null }
  | null

/** Routes a saved definition back to the editor that understands it. */
function editorFor(def: AnyPlacementDef): Editor {
  if (isStepPlacement(def)) return { type: 'steps', def }
  if (isGbPlacement(def)) return { type: 'gb', def }
  if (isMartiPlacement(def)) return { type: 'marti', def }
  return { type: 'placement', def }
}

function describeMoney(def: MoneyDef): string {
  if (def.description) return def.description
  if (def.mode === 'progression') return 'Custom progression'
  if (def.mode === 'sequence') return `Ladder: ${def.sequence.join('-')}`
  if (def.mode === 'steps') return `Step machine: ${def.steps.map(s => s.mult).join(' / ')} units`
  return `Cancellation line: ${def.line.join('-')}`
}

function describePlacement(def: AnyPlacementDef): string {
  if (def.description) return def.description
  if (isStepPlacement(def)) {
    return `Step system: ${def.steps.length} step${def.steps.length === 1 ? '' : 's'}`
  }
  if (isGbPlacement(def)) {
    return `GB system: ${def.legs.length} independent leg${def.legs.length === 1 ? '' : 's'}`
  }
  if (isMartiPlacement(def)) {
    return `Marti GB on ${def.anchor}: ${def.families.length} leg${def.families.length === 1 ? '' : 's'}, played in rounds`
  }
  return `${def.rules.length} rule${def.rules.length === 1 ? '' : 's'}`
}

export function BuilderPage({ customs, session, onChange, onExport, onShare }: Props) {
  const [editor, setEditor] = useState<Editor>(null)

  const savePlacement = (def: AnyPlacementDef) => {
    const others = customs.placements.filter(p => p.id !== def.id)
    onChange({ ...customs, placements: [...others, def] })
    setEditor(null)
  }

  const saveMoney = (def: MoneyDef) => {
    const others = customs.moneys.filter(m => m.id !== def.id)
    onChange({ ...customs, moneys: [...others, def] })
    setEditor(null)
  }

  const duplicatePlacement = (def: AnyPlacementDef) => {
    const prefix = isStepPlacement(def)
      ? 'custom-s'
      : isGbPlacement(def)
        ? 'custom-gb'
        : isMartiPlacement(def)
          ? 'custom-marti'
          : 'custom-p'
    setEditor(
      editorFor({
        ...def,
        id: `${prefix}-${crypto.randomUUID()}`,
        name: `${def.name} (copy)`,
      } as AnyPlacementDef),
    )
  }

  const duplicateMoney = (def: MoneyDef) => {
    setEditor({
      type: 'money',
      def: { ...def, id: `custom-m-${crypto.randomUUID()}`, name: `${def.name} (copy)` },
    })
  }

  return (
    <div className="builder-page">
      <div className="builder-intro panel">
        <div className="panel-title">System Builder</div>
        <p className="muted">
          Build your own placement systems (where the chips go) and money management
          systems (how the stake changes). Saved systems join the leaderboard instantly
          and are simulated against every other system, exactly like the built-ins.
        </p>
        <div className="builder-actions">
          <button
            className="btn btn-primary"
            onClick={() => setEditor({ type: 'placement', def: null })}
          >
            + New placement system
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setEditor({ type: 'steps', def: null })}
          >
            + New step system (board by board)
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setEditor({ type: 'gb', def: null })}
          >
            + New GB system (independent legs)
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setEditor({ type: 'marti', def: null })}
          >
            + New Marti GB (number-driven, in rounds)
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setEditor({ type: 'money', def: null })}
          >
            + New money management system
          </button>
        </div>
      </div>

      {editor?.type === 'placement' && (
        <div className="panel">
          <PlacementBuilder
            key={editor.def?.id ?? 'new'}
            initial={editor.def}
            session={session}
            onSave={savePlacement}
            onCancel={() => setEditor(null)}
          />
        </div>
      )}
      {editor?.type === 'steps' && (
        <div className="panel">
          <StepBuilder
            key={editor.def?.id ?? 'new'}
            initial={editor.def}
            session={session}
            onSave={savePlacement}
            onCancel={() => setEditor(null)}
          />
        </div>
      )}
      {editor?.type === 'gb' && (
        <div className="panel">
          <GbBuilder
            key={editor.def?.id ?? 'new'}
            initial={editor.def}
            session={session}
            onSave={savePlacement}
            onCancel={() => setEditor(null)}
          />
        </div>
      )}
      {editor?.type === 'marti' && (
        <div className="panel">
          <MartiBuilder
            key={editor.def?.id ?? 'new'}
            initial={editor.def}
            session={session}
            onSave={savePlacement}
            onCancel={() => setEditor(null)}
          />
        </div>
      )}
      {editor?.type === 'money' && (
        <div className="panel">
          <MoneyBuilder
            key={editor.def?.id ?? 'new'}
            initial={editor.def}
            session={session}
            onSave={saveMoney}
            onCancel={() => setEditor(null)}
          />
        </div>
      )}

      <div className="builder-lists">
        <div className="panel">
          <div className="panel-title">My placement systems ({customs.placements.length})</div>
          {customs.placements.length === 0 && (
            <span className="muted">Nothing yet — build your first placement system above.</span>
          )}
          {customs.placements.map(def => (
            <div className="saved-system" key={def.id}>
              <div>
                <strong>{def.name}</strong>
                <div className="muted">{describePlacement(def)}</div>
              </div>
              <div className="saved-actions">
                <button className="link" onClick={() => setEditor(editorFor(def))}>
                  Edit
                </button>
                <button className="link" onClick={() => duplicatePlacement(def)}>
                  Duplicate
                </button>
                <button className="link" onClick={() => onExport({ kind: 'placement', def })}>
                  Report
                </button>
                <button className="link" onClick={() => onShare({ kind: 'placement', def })}>
                  Share
                </button>
                <button
                  className="link danger"
                  onClick={() =>
                    onChange({
                      ...customs,
                      placements: customs.placements.filter(p => p.id !== def.id),
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-title">My money systems ({customs.moneys.length})</div>
          {customs.moneys.length === 0 && (
            <span className="muted">Nothing yet — build your first staking plan above.</span>
          )}
          {customs.moneys.map(def => (
            <div className="saved-system" key={def.id}>
              <div>
                <strong>{def.name}</strong>
                <div className="muted">{describeMoney(def)}</div>
              </div>
              <div className="saved-actions">
                <button className="link" onClick={() => setEditor({ type: 'money', def })}>
                  Edit
                </button>
                <button className="link" onClick={() => duplicateMoney(def)}>
                  Duplicate
                </button>
                <button className="link" onClick={() => onExport({ kind: 'money', def })}>
                  Report
                </button>
                <button className="link" onClick={() => onShare({ kind: 'money', def })}>
                  Share
                </button>
                <button
                  className="link danger"
                  onClick={() =>
                    onChange({
                      ...customs,
                      moneys: customs.moneys.filter(m => m.id !== def.id),
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
