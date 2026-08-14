import type { CustomSystems } from '../domain/custom/types'
import type { Session } from '../domain/types'

/**
 * Portable backup format. Everything the app knows lives in one browser's
 * localStorage, so a cleared cache would otherwise wipe it — this moves
 * sessions and systems in and out as a plain JSON file.
 */
export const BACKUP_FORMAT = 'roulette-system-tracker/backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  sessions: Session[]
  customSystems: CustomSystems
}

export function buildBackup(sessions: Session[], customSystems: CustomSystems): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
    customSystems,
  }
}

export interface ParsedBackup {
  sessions: Session[]
  customSystems: CustomSystems
}

/**
 * Validates an uploaded file. Being strict here keeps a mistyped file from
 * quietly replacing good data with nonsense.
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('That file does not contain a backup.')
  }
  const data = raw as Partial<BackupFile>
  if (data.format !== BACKUP_FORMAT) {
    throw new Error('That JSON is not a Roulette System Tracker backup.')
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new Error(
      `That backup was written by a newer version (v${data.version}) than this app understands.`,
    )
  }

  const sessions = Array.isArray(data.sessions) ? data.sessions.filter(isSession) : []
  const customs = data.customSystems
  const customSystems: CustomSystems = {
    placements: Array.isArray(customs?.placements) ? customs.placements : [],
    moneys: Array.isArray(customs?.moneys) ? customs.moneys : [],
  }
  if (sessions.length === 0 && customSystems.placements.length === 0 && customSystems.moneys.length === 0) {
    throw new Error('That backup is empty — nothing to import.')
  }
  return { sessions, customSystems }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<Session>
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    Array.isArray(s.spins) &&
    typeof s.config === 'object' &&
    s.config !== null
  )
}

/** Merges imported data alongside what is already here, without clobbering it. */
export function mergeBackup(
  current: { sessions: Session[]; customSystems: CustomSystems },
  incoming: ParsedBackup,
): { sessions: Session[]; customSystems: CustomSystems; added: string } {
  const sessionIds = new Set(current.sessions.map(s => s.id))
  const newSessions = incoming.sessions.filter(s => !sessionIds.has(s.id))

  const placementIds = new Set(current.customSystems.placements.map(p => p.id))
  const newPlacements = incoming.customSystems.placements.filter(p => !placementIds.has(p.id))

  const moneyIds = new Set(current.customSystems.moneys.map(m => m.id))
  const newMoneys = incoming.customSystems.moneys.filter(m => !moneyIds.has(m.id))

  const bits: string[] = []
  if (newSessions.length) bits.push(`${newSessions.length} session(s)`)
  if (newPlacements.length) bits.push(`${newPlacements.length} placement system(s)`)
  if (newMoneys.length) bits.push(`${newMoneys.length} money system(s)`)

  return {
    sessions: [...current.sessions, ...newSessions],
    customSystems: {
      placements: [...current.customSystems.placements, ...newPlacements],
      moneys: [...current.customSystems.moneys, ...newMoneys],
    },
    added: bits.length > 0 ? `Imported ${bits.join(', ')}.` : 'Everything in that file was already here.',
  }
}

/** Triggers a browser download of the backup. */
export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = backup.exportedAt.slice(0, 10)
  a.href = url
  a.download = `roulette-tracker-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
