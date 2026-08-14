import { describe, expect, it } from 'vitest'
import {
  adoptShared,
  buildShareLink,
  readShareLink,
} from '../../storage/shareLink'
import type { SharedSystem } from '../../storage/shareLink'
import type { GbPlacementDef, MoneyDef } from '../custom/types'

const BASE = 'https://tracker.example/app'

const gbSystem: GbPlacementDef = {
  variant: 'gb',
  id: 'gb-1',
  name: 'Outside Sleeper GB',
  description: 'Watches the outside bets',
  legs: [
    { target: { kind: 'fixed', bet: 'red' }, units: 1, trigger: { kind: 'asleep', spins: 5 } },
    { target: { kind: 'combo', numbers: [8, 11] }, units: 2, trigger: { kind: 'always' } },
  ],
}

const moneySystem: MoneyDef = {
  id: 'm-1',
  name: 'Climb & Bank',
  description: '',
  mode: 'progression',
  start: 1,
  onWin: { op: 'add', value: 1 },
  onLoss: { op: 'add', value: 1 },
  winStreakReset: 0,
  cap: 256,
}

describe('share links', () => {
  it('round-trips a placement system through a URL', () => {
    const link = buildShareLink({ kind: 'placement', def: gbSystem }, BASE)
    const read = readShareLink(link)
    expect(read?.kind).toBe('placement')
    expect(read?.def).toEqual(gbSystem)
  })

  it('round-trips a money system too', () => {
    const link = buildShareLink({ kind: 'money', def: moneySystem }, BASE)
    expect(readShareLink(link)?.def).toEqual(moneySystem)
  })

  it('keeps the definition in the fragment, which never reaches a server', () => {
    const link = buildShareLink({ kind: 'placement', def: gbSystem }, BASE)
    const [before, fragment] = link.split('#')
    expect(before).toBe(BASE)
    expect(fragment.startsWith('system=')).toBe(true)
    // Nothing readable leaks into the path or query.
    expect(before).not.toContain('Outside Sleeper')
  })

  it('survives names with characters base64 would trip over', () => {
    const def = { ...gbSystem, name: 'Café 100% — “GB” ✓' }
    const link = buildShareLink({ kind: 'placement', def }, BASE)
    expect(readShareLink(link)?.def.name).toBe('Café 100% — “GB” ✓')
  })

  it('replaces an existing fragment rather than stacking another', () => {
    const link = buildShareLink({ kind: 'money', def: moneySystem }, `${BASE}#system=stale`)
    expect(link.split('#').length).toBe(2)
    expect(readShareLink(link)?.def.name).toBe('Climb & Bank')
  })

  it('ignores a URL with no share fragment', () => {
    expect(readShareLink(BASE)).toBeNull()
    expect(readShareLink(`${BASE}#other=1`)).toBeNull()
  })

  it('refuses junk rather than importing nonsense', () => {
    expect(readShareLink(`${BASE}#system=not-base64!!`)).toBeNull()
    expect(readShareLink(`${BASE}#system=${btoa('{"hello":"world"}')}`)).toBeNull()
  })

  it('refuses a link written by a newer version', () => {
    const payload = btoa(
      JSON.stringify({
        format: 'roulette-system-tracker/system',
        version: 99,
        system: { kind: 'placement', def: gbSystem },
      }),
    )
    expect(readShareLink(`${BASE}#system=${payload}`)).toBeNull()
  })
})

describe('adopting a shared system', () => {
  it('gives the recipient their own id so nothing is overwritten', () => {
    const shared: SharedSystem = { kind: 'placement', def: gbSystem }
    const mine = adoptShared(shared)
    expect(mine.def.id).not.toBe(gbSystem.id)
    expect(mine.def.name).toBe(gbSystem.name)
    // The original is untouched — sharing copies, it does not move.
    expect(gbSystem.id).toBe('gb-1')
  })

  it('keeps the definition otherwise identical, so it simulates the same', () => {
    const mine = adoptShared({ kind: 'placement', def: gbSystem })
    expect({ ...mine.def, id: gbSystem.id }).toEqual(gbSystem)
  })
})
