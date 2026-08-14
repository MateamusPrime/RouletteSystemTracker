import type { Session } from '../domain/types'

/**
 * Persistence boundary. The app only talks to this interface, so swapping
 * localStorage for a real backend (e.g. Supabase with per-user auth for the
 * planned multi-tenant version) means writing one new implementation.
 */
export interface SessionRepository {
  list(): Promise<Session[]>
  get(id: string): Promise<Session | null>
  save(session: Session): Promise<void>
  remove(id: string): Promise<void>
}

const KEY = 'roulette-tracker:sessions'

function readAll(): Session[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session[]) : []
  } catch {
    return []
  }
}

function writeAll(sessions: Session[]): void {
  localStorage.setItem(KEY, JSON.stringify(sessions))
}

export class LocalSessionRepository implements SessionRepository {
  async list(): Promise<Session[]> {
    return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Session | null> {
    return readAll().find(s => s.id === id) ?? null
  }

  async save(session: Session): Promise<void> {
    const all = readAll()
    const idx = all.findIndex(s => s.id === session.id)
    if (idx >= 0) all[idx] = session
    else all.push(session)
    writeAll(all)
  }

  async remove(id: string): Promise<void> {
    writeAll(readAll().filter(s => s.id !== id))
  }
}

export const sessionRepository: SessionRepository = new LocalSessionRepository()
