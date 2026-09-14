import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  splitSeed,
  injectSeed,
  seedIdOf,
  escapeSeedJson,
  SEED_START,
  SEED_END,
} from '../standalone-seed.mjs'

const root = resolve(import.meta.dirname, '../..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

describe('shipped standalone builds', () => {
  it('RouletteTracker.html is standalone/index.html plus a baked seed, and nothing else', () => {
    const built = read('standalone/index.html')
    const { app } = splitSeed(read('RouletteTracker.html'))

    // Not toEqual: a mismatch here would dump ~450 KB of bundle into the report.
    expect(
      app === built,
      'RouletteTracker.html was baked from a different build than standalone/index.html. ' +
        'Re-run: npm run build:standalone && npm run bake -- <backup.json>',
    ).toBe(true)
  })
})

describe('seed boundary', () => {
  const bootstrap = `${SEED_START}\n  var seed = {"seedId":"seed:2026-01-01T00:00:00.000Z"};\n${SEED_END}`
  const page = '<!doctype html><html><body><div id="root"></div><script type="module">app()</script></body></html>'

  it('round-trips an injected seed', () => {
    const { seed, app } = splitSeed(injectSeed(page, bootstrap))
    expect(seed).toBe(bootstrap)
    expect(app).toBe(page)
  })

  it('injects ahead of the app script, so seeding runs before first render', () => {
    const seeded = injectSeed(page, bootstrap)
    expect(seeded.indexOf(SEED_START)).toBeLessThan(seeded.indexOf('<script type="module">'))
  })

  it('reports an unbaked file as having no seed', () => {
    expect(splitSeed(page)).toEqual({ seed: null, app: page })
  })

  it('does not mistake the app script for a seed', () => {
    expect(splitSeed('<script type="module">(function(){})()</script>').seed).toBe(null)
  })

  it('reads the seed id back out', () => {
    expect(seedIdOf(bootstrap)).toBe('seed:2026-01-01T00:00:00.000Z')
    expect(seedIdOf(null)).toBe(null)
  })

  it('escapes a seed payload that mentions its own end marker', () => {
    // The payload is attacker-ish data: a saved system could be named
    // "</script>". Escaping `<` keeps it from closing the tag early AND keeps
    // SEED_END unique, which is what makes splitting on it safe.
    const payload = escapeSeedJson(JSON.stringify({ n: '</script>', m: `})()</script>` }))
    expect(payload).not.toContain('</script>')
    expect(payload).not.toContain(SEED_END)

    const tricky = `${SEED_START}\n  var seed = ${payload};\n${SEED_END}`
    const { seed, app } = splitSeed(injectSeed(page, tricky))
    expect(app).toBe(page)
    expect(seed).toBe(tricky)
  })

  it('rejects a truncated seed rather than comparing the wrong bytes', () => {
    expect(() => splitSeed(`${SEED_START} var seed = {}; // never closed`)).toThrow(/no .* closing it/)
  })
})
