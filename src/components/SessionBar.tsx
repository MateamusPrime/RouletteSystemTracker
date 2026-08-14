import { useEffect, useRef, useState } from 'react'
import type { Session, SessionConfig } from '../domain/types'
import { SettingsDialog } from './SettingsDialog'

interface Props {
  session: Session
  savedSessions: Session[]
  onRename(name: string): void
  onConfigChange(config: SessionConfig): void
  onNew(): void
  onLoad(id: string): void
  onDelete(id: string): void
  onExport(): void
  onImport(file: File): void
  onReport(): void
}

export function SessionBar({
  session,
  savedSessions,
  onRename,
  onConfigChange,
  onNew,
  onLoad,
  onDelete,
  onExport,
  onImport,
  onReport,
}: Props) {
  const [name, setName] = useState(session.name)
  const [showSessions, setShowSessions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => setName(session.name), [session.id, session.name])

  const cfg = session.config
  const locked = session.spins.length > 0

  // A compact read-out of what the settings currently are, so the bar still
  // answers "what am I playing?" without holding every control.
  const guardrails = [
    cfg.stopWin ? `+$${cfg.stopWin}` : null,
    cfg.stopLoss ? `-$${cfg.stopLoss}` : null,
  ].filter(Boolean)

  return (
    <header className="session-bar">
      <div className="brand">
        <span className="brand-icon">◉</span> Roulette System Tracker
      </div>

      <input
        className="session-name"
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={() => onRename(name.trim() || 'Untitled session')}
        aria-label="session name"
      />

      <button
        className="btn gear-btn"
        onClick={() => setShowSettings(true)}
        title="Wheel, table limits, unit, bankroll and guardrails"
      >
        ⚙ Settings
      </button>

      <div className="config-summary" onClick={() => setShowSettings(true)} title="Open settings">
        <span><b>${cfg.baseUnit}</b> unit</span>
        <span><b>${cfg.startingBankroll}</b> bank</span>
        <span>{cfg.wheelType === 'american' ? 'American' : 'European'}</span>
        {cfg.tableMin ? <span>min <b>${cfg.tableMin}</b></span> : null}
        {cfg.clampToLimits && <span className="summary-flag">capped</span>}
        {guardrails.length > 0 && (
          <span className="summary-flag" title="Walk-away guardrails">
            stop {guardrails.join(' / ')}
          </span>
        )}
      </div>

      {showSettings && (
        <SettingsDialog
          config={cfg}
          locked={locked}
          onChange={onConfigChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="session-actions">
        <button className="btn" onClick={onNew}>New session</button>
        <button
          className="btn"
          onClick={onReport}
          disabled={session.spins.length === 0}
          title="A printable record of this session's spins, stats and leaderboard"
        >
          Report
        </button>
        <button className="btn" onClick={onExport} title="Download everything as a JSON backup">
          Export
        </button>
        <button
          className="btn"
          onClick={() => fileInput.current?.click()}
          title="Restore sessions and systems from a backup file"
        >
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) onImport(file)
            // Allow re-importing the same filename later.
            e.target.value = ''
          }}
        />
        <div className="dropdown">
          <button className="btn" onClick={() => setShowSessions(v => !v)}>
            Saved ({savedSessions.length}) ▾
          </button>
          {showSessions && (
            <div className="dropdown-menu">
              {savedSessions.length === 0 && (
                <div className="dropdown-item muted">No saved sessions yet</div>
              )}
              {savedSessions.map(s => (
                <div className="dropdown-item" key={s.id}>
                  <button
                    className="link"
                    onClick={() => {
                      onLoad(s.id)
                      setShowSessions(false)
                    }}
                  >
                    {s.name} <span className="muted">· {s.spins.length} spins · {new Date(s.updatedAt).toLocaleDateString()}</span>
                  </button>
                  {s.id !== session.id && (
                    <button
                      className="link danger"
                      title="Delete session"
                      onClick={() => onDelete(s.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
