import type { AnyPlacementDef, MoneyDef } from '../domain/custom/types'

/**
 * Sharing one system as a link.
 *
 * The definition travels **inside the URL fragment**, so the link is
 * self-contained: no server, no account, nothing to expire. The fragment never
 * reaches a server, so a shared system stays between the two people involved.
 *
 * Sharing copies rather than references. A recipient saves their own snapshot,
 * so the author editing their copy later cannot silently change the rules a
 * saved session was already simulated against — past leaderboards stay
 * reproducible. A future `/s/<token>` link backed by the database should keep
 * exactly these semantics and fall back to this format.
 */

export const SHARE_KIND = 'roulette-system-tracker/system'
export const SHARE_VERSION = 1
const FRAGMENT_KEY = 'system'

export type SharedSystem =
  | { kind: 'placement'; def: AnyPlacementDef }
  | { kind: 'money'; def: MoneyDef }

interface SharePayload {
  format: typeof SHARE_KIND
  version: number
  system: SharedSystem
}

/** URL-safe base64 that survives being pasted into a chat window. */
function encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function buildShareLink(system: SharedSystem, baseUrl: string): string {
  const payload: SharePayload = {
    format: SHARE_KIND,
    version: SHARE_VERSION,
    system,
  }
  const base = baseUrl.split('#')[0]
  return `${base}#${FRAGMENT_KEY}=${encode(JSON.stringify(payload))}`
}

/** Reads a shared system out of a URL, or null when there is not one. */
export function readShareLink(url: string): SharedSystem | null {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : ''
  const params = new URLSearchParams(hash)
  const raw = params.get(FRAGMENT_KEY)
  if (!raw) return null
  try {
    const payload = JSON.parse(decode(raw)) as Partial<SharePayload>
    if (payload.format !== SHARE_KIND) return null
    if (typeof payload.version !== 'number' || payload.version > SHARE_VERSION) return null
    const system = payload.system
    if (!system || (system.kind !== 'placement' && system.kind !== 'money')) return null
    if (!system.def || typeof system.def !== 'object' || !('name' in system.def)) return null
    return system
  } catch {
    return null
  }
}

/**
 * A shared system becomes the recipient's own copy, with a fresh id so it can
 * never collide with — or overwrite — something they already have.
 */
export function adoptShared(system: SharedSystem): SharedSystem {
  const prefix = system.kind === 'money' ? 'custom-m' : 'custom-shared'
  const def = { ...system.def, id: `${prefix}-${crypto.randomUUID()}` }
  return { kind: system.kind, def } as SharedSystem
}

/** Removes the share fragment so a refresh does not re-prompt. */
export function clearShareFragment(): void {
  if (typeof history === 'undefined') return
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
