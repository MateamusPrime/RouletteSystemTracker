import type { PlacementSystem } from './types'
import { ALL_PLACEMENT_SYSTEMS } from './systems'

export type { PlacementContext, PlacementSystem } from './types'

/** What each built-in pays, shown as the hover card's badge. */
const BADGES: Record<string, string> = {
  'always-red': 'Even money · 1:1',
  'always-black': 'Even money · 1:1',
  'follow-last-color': 'Even money · 1:1',
  'opposite-last-color': 'Even money · 1:1',
  'follow-last-dozen': 'Dozen · 2:1',
  'follow-last-column': 'Column · 2:1',
  'follow-last-odd-even': 'Even money · 1:1',
  'follow-last-high-low': 'Even money · 1:1',
  'opposite-last-dozen': 'Two dozens · 2:1',
  'opposite-last-column': 'Two columns · 2:1',
  'opposite-last-odd-even': 'Even money · 1:1',
  'opposite-last-high-low': 'Even money · 1:1',
  'sleeping-column': 'Column · 2:1',
  'sleeping-color': 'Even money · 1:1',
  'sleeping-odd-even': 'Even money · 1:1',
  'sleeping-high-low': 'Even money · 1:1',
  'sleeper-gb': 'GB · 12 independent legs',
  'streak-breaker': 'Even money · 1:1',
  'hot-dozen': 'Dozen · 2:1',
  'cold-dozen': 'Dozen · 2:1',
  'double-dozen': 'Two dozens · 2:1',
  'hot-column': 'Column · 2:1',
  'hot-numbers': 'Straight up · 35:1',
  'neighbours-of-last-3': 'Straight up · 35:1',
  'neighbours-of-last': 'Straight up · 35:1',
  'neighbours-of-last-7': 'Straight up · 35:1',
  'neighbours-of-last-9': 'Straight up · 35:1',
  'neighbours-of-last-11': 'Straight up · 35:1',
  'broke-dick-jelly-flat': 'Straight up · 35:1',
  'hot-sector': 'Straight up · 35:1',
  'cold-sector': 'Straight up · 35:1',
  'sleeping-sector': 'Straight up · 35:1',
  'sleeper-dozen': 'Dozen · 2:1',
}

const registry = new Map<string, PlacementSystem>()
for (const s of ALL_PLACEMENT_SYSTEMS) {
  registry.set(s.id, {
    ...s,
    summary: s.summary ?? { badge: BADGES[s.id] ?? 'Placement', intro: s.description },
  })
}

/** Register an additional placement system at runtime (future plugin support). */
export function registerPlacementSystem(system: PlacementSystem): void {
  registry.set(system.id, system)
}

export function placementSystems(): PlacementSystem[] {
  return [...registry.values()]
}
