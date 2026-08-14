import type { CustomSystems } from '../domain/custom/types'

/**
 * Persistence for user-built systems. Same swap-for-a-backend story as
 * SessionRepository: the app only calls load/save.
 */
const KEY = 'roulette-tracker:custom-systems'

export function loadCustomSystems(): CustomSystems {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { placements: [], moneys: [] }
    const parsed = JSON.parse(raw) as Partial<CustomSystems>
    return {
      placements: Array.isArray(parsed.placements) ? parsed.placements : [],
      moneys: Array.isArray(parsed.moneys) ? parsed.moneys : [],
    }
  } catch {
    return { placements: [], moneys: [] }
  }
}

export function saveCustomSystems(systems: CustomSystems): void {
  localStorage.setItem(KEY, JSON.stringify(systems))
}
