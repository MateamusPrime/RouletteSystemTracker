import { useCallback, useEffect, useMemo, useState } from 'react'
import { BuilderPage } from './components/builder/BuilderPage'
import { SessionReport } from './components/report/SessionReport'
import { SystemReport } from './components/report/SystemReport'
import type { ReportTarget } from './components/report/SystemReport'
import { ComboPanel } from './components/ComboPanel'
import { FollowLeader } from './components/FollowLeader'
import { HistoryStrip } from './components/HistoryStrip'
import { Leaderboard, NO_FILTERS, applyFilters, comboKey, filtersActive } from './components/Leaderboard'
import type { LeaderboardFilters } from './components/Leaderboard'
import { ComboCompare } from './components/ComboCompare'
import { NumberPad } from './components/NumberPad'
import { Recommendation } from './components/Recommendation'
import { SessionBar } from './components/SessionBar'
import { StatsPanel } from './components/StatsPanel'
import { buildMoneySystem } from './domain/custom/moneyInterpreter'
import { buildAnyPlacementSystem } from './domain/custom/placementInterpreter'
import type { AnyPlacementDef, CustomSystems, MoneyDef } from './domain/custom/types'
import {
  adoptShared,
  buildShareLink,
  clearShareFragment,
  readShareLink,
} from './storage/shareLink'
import type { SharedSystem } from './storage/shareLink'
import { moneySystems } from './domain/money'
import { placementSystems } from './domain/placement'
import { simulateAll, simulateCombo } from './domain/simulation'
import { StressTest } from './components/StressTest'
import { computeStats } from './domain/stats'
import type { Session, SessionConfig } from './domain/types'
import { buildBackup, downloadBackup, mergeBackup, parseBackup } from './storage/backup'
import { loadCustomSystems, saveCustomSystems } from './storage/customStore'
import { sessionRepository } from './storage/sessionStore'

/** One-line summary of a shared system, for the import prompt. */
function buildAnyDescription(shared: SharedSystem): string {
  if (shared.kind === 'money') return `Money management · ${(shared.def as MoneyDef).mode}`
  const system = buildAnyPlacementSystem(shared.def as AnyPlacementDef)
  return system.summary?.badge ?? 'Placement system'
}

function newSession(): Session {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: `Session ${new Date(now).toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    config: { wheelType: 'european', startingBankroll: 500, baseUnit: 5 },
    spins: [],
  }
}

export default function App() {
  const [session, setSession] = useState<Session>(newSession)
  const [savedSessions, setSavedSessions] = useState<Session[]>([])
  const [selectedCombo, setSelectedCombo] = useState<string | null>(null)
  const [comparedCombo, setComparedCombo] = useState<string | null>(null)
  const [filters, setFilters] = useState<LeaderboardFilters>(NO_FILTERS)
  /**
   * Whether the current filter was chosen BEFORE seeing this session's results.
   * Only then does the smaller field honestly lower the significance bar, so it
   * is an explicit claim the player makes rather than a silent side effect.
   */
  const [preCommitted, setPreCommitted] = useState(false)
  const [view, setView] = useState<'tracker' | 'builder' | 'stress'>('tracker')
  const [customs, setCustoms] = useState<CustomSystems>(loadCustomSystems)
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showSessionReport, setShowSessionReport] = useState(false)
  const [incomingShare, setIncomingShare] = useState<SharedSystem | null>(null)

  const handleCustomsChange = useCallback((next: CustomSystems) => {
    setCustoms(next)
    saveCustomSystems(next)
  }, [])

  const refreshSaved = useCallback(async () => {
    setSavedSessions(await sessionRepository.list())
  }, [])

  // On first load, resume the most recent session if one exists.
  useEffect(() => {
    void (async () => {
      const all = await sessionRepository.list()
      setSavedSessions(all)
      if (all.length > 0) setSession(all[0])
    })()
  }, [])

  // Autosave on every change (only once the session has content or a custom name).
  useEffect(() => {
    if (session.spins.length === 0) return
    void sessionRepository.save(session).then(refreshSaved)
  }, [session, refreshSaved])

  const updateSession = useCallback((patch: Partial<Session>) => {
    setSession(s => ({ ...s, ...patch, updatedAt: Date.now() }))
  }, [])

  const recordSpin = useCallback(
    (n: number) => {
      updateSession({ spins: [...session.spins, { n, ts: Date.now() }] })
    },
    [session.spins, updateSession],
  )

  const undo = useCallback(() => {
    updateSession({ spins: session.spins.slice(0, -1) })
  }, [session.spins, updateSession])

  const editSpin = useCallback(
    (index: number, n: number) => {
      updateSession({
        spins: session.spins.map((s, i) => (i === index ? { ...s, n } : s)),
      })
    },
    [session.spins, updateSession],
  )

  const deleteSpin = useCallback(
    (index: number) => {
      updateSession({ spins: session.spins.filter((_, i) => i !== index) })
    },
    [session.spins, updateSession],
  )

  const allPlacements = useMemo(
    () => [...placementSystems(), ...customs.placements.map(buildAnyPlacementSystem)],
    [customs.placements],
  )
  const allMoneys = useMemo(
    () => [...moneySystems(), ...customs.moneys.map(buildMoneySystem)],
    [customs.moneys],
  )

  const results = useMemo(
    () => simulateAll(allPlacements, allMoneys, session.spins, session.config),
    [allPlacements, allMoneys, session.spins, session.config],
  )

  // The headline follows whatever the leaderboard is showing, so filtering to
  // one system does not leave the banner recommending something off-screen.
  const visibleResults = useMemo(() => applyFilters(results, filters), [results, filters])

  // Prefer combos that were actually playable: not busted, and within the
  // table's limits when they are configured.
  const best = useMemo(() => {
    const legal = visibleResults.filter(r => !r.busted && r.limitBreaches === 0)
    const alive = visibleResults.filter(r => !r.busted)
    const pool = legal.length > 0 ? legal : alive.length > 0 ? alive : visibleResults
    return pool.reduce<(typeof visibleResults)[number] | null>(
      (top, r) => (top === null || r.profit > top.profit ? r : top),
      null,
    )
  }, [visibleResults])

  /** Second-placed combo, used to judge whether the leader is really ahead. */
  const runnerUp = useMemo(() => {
    if (!best) return null
    return visibleResults
      .filter(r => r !== best && !r.busted)
      .reduce<(typeof results)[number] | null>(
        (top, r) => (top === null || r.profit > top.profit ? r : top),
        null,
      )
  }, [visibleResults, best])

  const stats = useMemo(
    () => computeStats(session.spins, session.config.wheelType),
    [session.spins, session.config.wheelType],
  )

  const selected = useMemo(
    () => results.find(r => comboKey(r) === selectedCombo) ?? null,
    [results, selectedCombo],
  )

  const compared = useMemo(
    () => results.find(r => comboKey(r) === comparedCombo) ?? null,
    [results, comparedCombo],
  )

  // The spin-by-spin trace is only computed for the combo being inspected.
  const selectedTrace = useMemo(() => {
    if (!selected) return null
    const placement = allPlacements.find(p => p.id === selected.placementId)
    const moneySys = allMoneys.find(m => m.id === selected.moneyId)
    if (!placement || !moneySys) return null
    return simulateCombo(placement, moneySys, session.spins, session.config, { trace: true })
  }, [selected, allPlacements, allMoneys, session.spins, session.config])

  const handleNew = useCallback(() => {
    setSession(newSession())
    setSelectedCombo(null)
  }, [])

  const handleLoad = useCallback(async (id: string) => {
    const s = await sessionRepository.get(id)
    if (s) {
      setSession(s)
      setSelectedCombo(null)
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      await sessionRepository.remove(id)
      await refreshSaved()
    },
    [refreshSaved],
  )

  const handleConfig = useCallback(
    (config: SessionConfig) => updateSession({ config }),
    [updateSession],
  )

  const handleShare = useCallback(async (system: SharedSystem) => {
    const link = buildShareLink(system, window.location.href)
    try {
      await navigator.clipboard.writeText(link)
      setNotice(`Share link for "${system.def.name}" copied — it carries the whole system.`)
    } catch {
      // Clipboard access can be refused; show the link so it can be copied by hand.
      window.prompt('Copy this share link:', link)
    }
  }, [])

  /** A shared system arrives in the URL fragment; adopt it as the user's own. */
  const adoptSharedSystem = useCallback(
    (shared: SharedSystem) => {
      const mine = adoptShared(shared)
      const next =
        mine.kind === 'money'
          ? { ...customs, moneys: [...customs.moneys, mine.def as MoneyDef] }
          : { ...customs, placements: [...customs.placements, mine.def as AnyPlacementDef] }
      handleCustomsChange(next)
      setIncomingShare(null)
      clearShareFragment()
      setView('builder')
      setNotice(`Saved "${mine.def.name}" to your systems.`)
    },
    [customs, handleCustomsChange],
  )

  // A share link opens to a preview rather than importing silently. Pasting one
  // into an already-open tab only changes the hash, so watch for that too.
  useEffect(() => {
    const check = () => {
      const shared = readShareLink(window.location.href)
      if (shared) setIncomingShare(shared)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  const handleExport = useCallback(async () => {
    const all = await sessionRepository.list()
    // Include the session in progress even if it has not autosaved yet.
    const sessions = all.some(s => s.id === session.id) ? all : [...all, session]
    downloadBackup(buildBackup(sessions, customs))
    setNotice(`Exported ${sessions.length} session(s) and your custom systems.`)
  }, [session, customs])

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const parsed = parseBackup(await file.text())
        const existing = await sessionRepository.list()
        const merged = mergeBackup(
          { sessions: existing, customSystems: customs },
          parsed,
        )
        for (const s of merged.sessions) await sessionRepository.save(s)
        handleCustomsChange(merged.customSystems)
        await refreshSaved()
        setNotice(merged.added)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'That file could not be imported.')
      }
    },
    [customs, handleCustomsChange, refreshSaved],
  )

  if (reportTarget) {
    return <SystemReport target={reportTarget} onClose={() => setReportTarget(null)} />
  }

  if (showSessionReport) {
    return (
      <SessionReport
        session={session}
        results={results}
        onClose={() => setShowSessionReport(false)}
      />
    )
  }

  return (
    <div className="app">
      <SessionBar
        session={session}
        savedSessions={savedSessions}
        onRename={name => updateSession({ name })}
        onConfigChange={handleConfig}
        onNew={handleNew}
        onLoad={handleLoad}
        onDelete={handleDelete}
        onExport={handleExport}
        onImport={handleImport}
        onReport={() => setShowSessionReport(true)}
      />
      {notice && (
        <div className="app-notice">
          {notice}
          <button className="link" onClick={() => setNotice(null)}>dismiss</button>
        </div>
      )}
      {incomingShare && (
        <div className="app-notice share-invite">
          <div>
            <strong>Someone shared a system with you:</strong>{' '}
            <strong className="share-name">{incomingShare.def.name}</strong>
            <div className="muted">
              {buildAnyDescription(incomingShare)} — saving makes your own copy, so their
              later edits will not change yours.
            </div>
          </div>
          <div className="builder-actions">
            <button className="btn btn-primary" onClick={() => adoptSharedSystem(incomingShare)}>
              Save to my systems
            </button>
            <button
              className="btn"
              onClick={() => {
                setIncomingShare(null)
                clearShareFragment()
              }}
            >
              No thanks
            </button>
          </div>
        </div>
      )}
      <nav className="view-tabs">
        <button
          className={`view-tab ${view === 'tracker' ? 'active' : ''}`}
          onClick={() => setView('tracker')}
        >
          Tracker
        </button>
        <button
          className={`view-tab ${view === 'builder' ? 'active' : ''}`}
          onClick={() => setView('builder')}
        >
          System Builder
          {customs.placements.length + customs.moneys.length > 0 &&
            ` (${customs.placements.length + customs.moneys.length})`}
        </button>
        <button
          className={`view-tab ${view === 'stress' ? 'active' : ''}`}
          onClick={() => setView('stress')}
        >
          Stress Test
        </button>
      </nav>

      {view === 'stress' && (
        <StressTest
          placements={allPlacements}
          moneys={allMoneys}
          session={session}
          leaderboard={[...visibleResults].sort((a, b) => b.profit - a.profit)}
        />
      )}

      {view === 'builder' && (
        <BuilderPage
          customs={customs}
          session={session}
          onChange={handleCustomsChange}
          onExport={setReportTarget}
          onShare={handleShare}
        />
      )}

      <main className="layout" style={view !== 'tracker' ? { display: 'none' } : undefined}>
        <section className="col col-entry">
          <div className="panel">
            <div className="panel-title">Record Spin</div>
            <NumberPad wheelType={session.config.wheelType} onSpin={recordSpin} />
          </div>
          <div className="panel">
            <HistoryStrip
              spins={session.spins}
              wheelType={session.config.wheelType}
              onUndo={undo}
              onEdit={editSpin}
              onDelete={deleteSpin}
            />
          </div>
          <div className="panel">
            <StatsPanel stats={stats} />
          </div>
        </section>

        <section className="col col-main">
          <Recommendation
            best={session.spins.length >= 5 ? best : null}
            runnerUp={runnerUp}
            /* The bar is set by how many combos were SEARCHED to find this one,
               not how many are on screen — filtering after the fact cannot
               launder a result. */
            searchedCount={results.length}
            shownCount={visibleResults.length}
            filtered={filtersActive(filters)}
            preCommitted={preCommitted}
            onPreCommittedChange={setPreCommitted}
            wheelType={session.config.wheelType}
            spinCount={session.spins.length}
          />
          <FollowLeader
            results={results}
            placements={allPlacements}
            moneys={allMoneys}
            session={session}
          />
          <div className="panel">
            <Leaderboard
              results={results}
              selectedKey={selectedCombo}
              onSelect={setSelectedCombo}
              filters={filters}
              onFiltersChange={next => {
                setFilters(next)
                // Clearing the filter means there is no shortlist to have
                // pre-committed to, so the claim lapses with it.
                if (!filtersActive(next)) setPreCommitted(false)
              }}
              comparedKey={comparedCombo}
              onCompare={setComparedCombo}
            />
          </div>
          <ComboPanel
            combo={selectedTrace}
            startingBankroll={session.config.startingBankroll}
          />
          {comparedCombo && (
            <ComboCompare
              a={selected}
              b={compared}
              startingBankroll={session.config.startingBankroll}
              wheelType={session.config.wheelType}
              onClear={() => setComparedCombo(null)}
            />
          )}
        </section>
      </main>
    </div>
  )
}
