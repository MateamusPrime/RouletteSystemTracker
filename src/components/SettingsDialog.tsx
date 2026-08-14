import { useEffect, useState } from 'react'
import { DEFAULT_GB_SLEEP } from '../domain/placement/systems'
import { PAYOUT_TIERS } from '../domain/types'
import type { SessionConfig } from '../domain/types'
import {
  allTableProfiles,
  applyProfile,
  loadTableProfiles,
  profileFromConfig,
  profileMatches,
  saveTableProfiles,
} from '../storage/tableProfiles'
import type { TableProfile } from '../storage/tableProfiles'

interface Props {
  config: SessionConfig
  /** Wheel type cannot change once spins exist — the history would not match. */
  locked: boolean
  onChange(config: SessionConfig): void
  onClose(): void
}

/** A number field where blank means "no limit", rather than forcing a 0. */
function OptionalMoney({
  label,
  hint,
  value,
  onChange,
  placeholder = 'none',
}: {
  label: string
  hint?: string
  value: number | undefined
  onChange(v: number | undefined): void
  placeholder?: string
}) {
  return (
    <label className="settings-field" title={hint}>
      <span className="settings-label">{label}</span>
      <input
        type="number"
        min={0}
        placeholder={placeholder}
        value={value ? String(value) : ''}
        onChange={e => {
          const raw = e.target.value.trim()
          const n = Number(raw)
          onChange(raw === '' || !Number.isFinite(n) || n <= 0 ? undefined : n)
        }}
      />
    </label>
  )
}

/**
 * Every session setting in one place, grouped the way a player thinks about
 * them: the table you are sitting at, the money you brought, and the rules you
 * have set for walking away. Replaces the row of controls that used to crowd
 * the top bar.
 */
export function SettingsDialog({ config, locked, onChange, onClose }: Props) {
  const [profiles, setProfiles] = useState<TableProfile[]>(allTableProfiles)
  const activeProfileId = profiles.find(p => profileMatches(config, p))?.id ?? ''

  // Escape closes, matching every other dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch: Partial<SessionConfig>) => onChange({ ...config, ...patch })

  const setTier = (payout: number, v: number | undefined) => {
    const next = { ...(config.tableMaxByPayout ?? {}) }
    if (v === undefined) delete next[String(payout)]
    else next[String(payout)] = v
    set({ tableMaxByPayout: next })
  }

  const tiersUsed = Object.values(config.tableMaxByPayout ?? {}).filter(v => v > 0).length

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="panel-title">⚙ Session settings</span>
          <button className="btn btn-small" onClick={onClose}>Done</button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-title">Table</div>
            <div className="settings-grid">
              <label className="settings-field" title={locked ? 'Locked once spins are recorded — the history would no longer match' : 'European has one zero; American adds 00'}>
                <span className="settings-label">Wheel</span>
                <select
                  value={config.wheelType}
                  disabled={locked}
                  onChange={e => set({ wheelType: e.target.value as SessionConfig['wheelType'] })}
                >
                  <option value="european">European (0)</option>
                  <option value="american">American (0/00)</option>
                </select>
              </label>
              <label className="settings-field" title="Load a saved table's limits">
                <span className="settings-label">Saved table</span>
                <select
                  value={activeProfileId}
                  onChange={e => {
                    const p = profiles.find(x => x.id === e.target.value)
                    if (p) onChange(applyProfile(config, p))
                  }}
                >
                  <option value="">Custom limits…</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <OptionalMoney
                label="Table minimum"
                hint="Per outside bet, and applied to the inside-bet total the way real tables do"
                value={config.tableMin}
                onChange={v => set({ tableMin: v })}
              />
            </div>
            <button
              className="btn btn-small"
              onClick={() => {
                const name = window.prompt('Name this table', 'My table')
                if (!name?.trim()) return
                saveTableProfiles([...loadTableProfiles(), profileFromConfig(name.trim(), config)])
                setProfiles(allTableProfiles())
              }}
            >
              Save as table profile
            </button>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">
              Maximum bet per payout type
              {tiersUsed > 0 && <span className="muted"> · {tiersUsed} set</span>}
            </div>
            <p className="muted settings-note">
              Online tables quote a separate ceiling for each bet type. Fill in the ones your
              table publishes; anything left blank falls back to the catch-all maximums below.
            </p>
            <div className="settings-grid tiers">
              {PAYOUT_TIERS.map(t => (
                <OptionalMoney
                  key={t.payout}
                  label={`${t.payout}:1 · ${t.label}`}
                  hint={t.example}
                  value={config.tableMaxByPayout?.[String(t.payout)]}
                  onChange={v => setTier(t.payout, v)}
                />
              ))}
            </div>
            <div className="settings-grid">
              <OptionalMoney
                label="Fallback max — outside"
                hint="Used for 1:1 and 2:1 bets with no tier set above"
                value={config.tableMaxOutside}
                onChange={v => set({ tableMaxOutside: v })}
              />
              <OptionalMoney
                label="Fallback max — inside"
                hint="Used for straight, split, street, corner and six-line bets with no tier set above"
                value={config.tableMaxInside}
                onChange={v => set({ tableMaxInside: v })}
              />
            </div>
            <label
              className="checkbox-field settings-check"
              title="On: bets are capped to the ceiling and played there, so a Martingale wanting $640 bets $500 and can only win $500 back. Off: over-limit bets are flagged but simulated in full."
            >
              <input
                type="checkbox"
                checked={config.clampToLimits ?? false}
                onChange={e => set({ clampToLimits: e.target.checked })}
              />
              Cap bets to these limits (instead of only flagging them)
            </label>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">Money</div>
            <div className="settings-grid">
              <label className="settings-field" title="What every system's stake is measured in">
                <span className="settings-label">Unit $</span>
                <input
                  type="number"
                  min={1}
                  value={config.baseUnit}
                  onChange={e => set({ baseUnit: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <label className="settings-field" title="What each combo starts the session with">
                <span className="settings-label">Starting bankroll $</span>
                <input
                  type="number"
                  min={1}
                  value={config.startingBankroll}
                  onChange={e =>
                    set({ startingBankroll: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">Guardrails</div>
            <p className="muted settings-note">
              Walk-away points measured against the starting bankroll. A combo that reaches
              one stops playing for the rest of the session, the way a disciplined player
              would. Leave blank for no guardrail.
            </p>
            <div className="settings-grid">
              <OptionalMoney
                label="Stop on win $"
                hint="Bank the win and quit once up this much"
                value={config.stopWin}
                onChange={v => set({ stopWin: v })}
              />
              <OptionalMoney
                label="Stop on loss $"
                hint="Quit once down this much, rather than playing to zero"
                value={config.stopLoss}
                onChange={v => set({ stopLoss: v })}
              />
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-title">Advanced</div>
            <div className="settings-grid">
              <label
                className="settings-field"
                title="Only the built-in Sleeper GB and sleeper systems use this. Custom GB systems keep the wait saved in their own definition, so systems built around a specific wait are never overridden."
              >
                <span className="settings-label">Default sleep (built-in sleepers)</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={config.gbSleepSpins ?? DEFAULT_GB_SLEEP}
                  onChange={e =>
                    set({ gbSleepSpins: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })
                  }
                />
              </label>
            </div>
            <p className="muted settings-note">
              Custom GB systems carry their own wait, so “Splits GB (Wait for 10)” and
              “(Wait for 15)” stay distinct no matter what this is set to.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
