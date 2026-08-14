import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, buildBackup, mergeBackup, parseBackup } from '../../storage/backup'
import type { CustomSystems } from '../custom/types'
import type { Session } from '../types'

function session(id: string, name = id): Session {
  return {
    id,
    name,
    createdAt: 1,
    updatedAt: 2,
    config: { wheelType: 'european', startingBankroll: 500, baseUnit: 5 },
    spins: [{ n: 7, ts: 3 }],
  }
}

const emptyCustoms: CustomSystems = { placements: [], moneys: [] }

describe('backup round trip', () => {
  it('survives export then import unchanged', () => {
    const customs: CustomSystems = {
      placements: [
        { id: 'p1', name: 'Mine', description: '', minSpins: 0, rules: [] },
      ],
      moneys: [
        {
          id: 'm1',
          name: 'Mine',
          description: '',
          mode: 'cancellation',
          line: [1, 2, 3],
          cap: 64,
        },
      ],
    }
    const text = JSON.stringify(buildBackup([session('a')], customs))
    const parsed = parseBackup(text)
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0].spins[0].n).toBe(7)
    expect(parsed.customSystems.placements[0].id).toBe('p1')
    expect(parsed.customSystems.moneys[0].id).toBe('m1')
  })

  it('stamps the format and a date', () => {
    const backup = buildBackup([session('a')], emptyCustoms)
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('rejecting bad files', () => {
  it('rejects non-JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(/valid JSON/)
  })

  it('rejects JSON that is not a backup', () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow(/not a Roulette System Tracker backup/)
  })

  it('refuses a backup from a newer version', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: 99, sessions: [] })
    expect(() => parseBackup(text)).toThrow(/newer version/)
  })

  it('rejects an empty backup', () => {
    const text = JSON.stringify(buildBackup([], emptyCustoms))
    expect(() => parseBackup(text)).toThrow(/empty/)
  })

  it('drops malformed sessions rather than importing junk', () => {
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      sessions: [session('good'), { id: 'bad' }],
      customSystems: emptyCustoms,
    })
    const parsed = parseBackup(text)
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0].id).toBe('good')
  })
})

describe('merging', () => {
  const current = {
    sessions: [session('a')],
    customSystems: {
      placements: [{ id: 'p1', name: 'Existing', description: '', minSpins: 0, rules: [] }],
      moneys: [],
    } as CustomSystems,
  }

  it('adds only what is new and never clobbers existing work', () => {
    const merged = mergeBackup(current, {
      sessions: [session('a', 'renamed elsewhere'), session('b')],
      customSystems: {
        placements: [{ id: 'p1', name: 'Different', description: '', minSpins: 0, rules: [] }],
        moneys: [],
      },
    })
    expect(merged.sessions.map(s => s.id)).toEqual(['a', 'b'])
    // The existing copy of 'a' and 'p1' is kept as-is.
    expect(merged.sessions[0].name).toBe('a')
    expect(merged.customSystems.placements).toHaveLength(1)
    expect(merged.customSystems.placements[0].name).toBe('Existing')
    expect(merged.added).toContain('1 session(s)')
  })

  it('says so when there was nothing new', () => {
    const merged = mergeBackup(current, { sessions: [session('a')], customSystems: emptyCustoms })
    expect(merged.added).toMatch(/already here/)
  })
})
