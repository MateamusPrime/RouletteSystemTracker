import { readFileSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { splitSeed, seedIdOf } from './standalone-seed.mjs'

/**
 * Fails the build when the two shipped single-file builds have drifted apart.
 *
 *   node scripts/check-standalone-sync.mjs
 *
 * `standalone/index.html` is the raw output of `npm run build:standalone`.
 * `RouletteTracker.html` is that same file with a seed baked in by `npm run bake`
 * — and nothing else. So with the seed lifted back out, the two must be byte
 * identical. They drift when the standalone build is regenerated from changed
 * source and the tracker file is not re-baked, which silently ships an old app
 * to anyone who opens the file the README points at.
 */

const root = resolve(import.meta.dirname, '..')
const BUILT = 'standalone/index.html'
const BAKED = 'RouletteTracker.html'

const fail = (...lines) => {
  console.error(`✗ ${BAKED} and ${BUILT} have drifted.\n`)
  for (const line of lines) console.error(line)
  console.error(`
To re-sync, rebuild and re-bake from a backup exported from the app:

  npm run build:standalone
  npm run bake -- path/to/roulette-tracker-backup.json
`)
  process.exit(1)
}

const read = (rel) => {
  const path = resolve(root, rel)
  if (!existsSync(path)) {
    console.error(`✗ ${rel} is missing — it is a committed build output, not a local artifact.`)
    process.exit(1)
  }
  return readFileSync(path, 'utf8')
}

const built = read(BUILT)
const baked = read(BAKED)

let seed, app
try {
  ({ seed, app } = splitSeed(baked))
} catch (err) {
  console.error(`✗ Could not read the seed in ${BAKED}: ${err.message}`)
  process.exit(1)
}

if (app === built) {
  const id = seedIdOf(seed)
  const size = Math.round(Buffer.byteLength(built) / 1024)
  console.log(
    `✓ ${BAKED} matches ${BUILT} (${size} KB of app code, ` +
      (seed ? `seed ${id})` : 'no seed baked in)'),
  )
  process.exit(0)
}

// Same app code is expected; report precisely how the two diverge.
const at = [...app].findIndex((ch, i) => ch !== built[i])
const offset = at === -1 ? Math.min(app.length, built.length) : at
const context = (s) => JSON.stringify(s.slice(Math.max(0, offset - 40), offset + 40))

fail(
  seed
    ? `  ${BAKED} carries seed ${seedIdOf(seed)}; with it removed, ${Buffer.byteLength(app)} bytes remain.`
    : `  ${BAKED} has no baked seed, so it should equal ${BUILT} exactly.`,
  `  ${BUILT} is ${Buffer.byteLength(built)} bytes.`,
  '',
  `  First difference at byte ${offset} of the app code:`,
  `    ${relative('.', BAKED)}: ${context(app)}`,
  `    ${relative('.', BUILT)}: ${context(built)}`,
)
