import type { MoneyManagementSystem } from './types'
import { ALL_MONEY_SYSTEMS } from './systems'

export type { MoneyManagementSystem } from './types'

const registry = new Map<string, MoneyManagementSystem<any>>()
for (const s of ALL_MONEY_SYSTEMS) registry.set(s.id, s)

/** Register an additional money management system at runtime (future plugin support). */
export function registerMoneySystem(system: MoneyManagementSystem<any>): void {
  registry.set(system.id, system)
}

export function moneySystems(): MoneyManagementSystem<any>[] {
  return [...registry.values()]
}
