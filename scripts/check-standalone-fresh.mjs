import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Fails the build when the committed standalone build is stale.
 *
 *   node scripts/check-standalone-fresh.mjs
 *
 * `check-standalone-sync.mjs` proves the two shipped single-file builds agree
 * with each other. Neither would notice if BOTH were old — a source change that
 * never gets `npm run build:standalone` leaves them consistent but behind, and
 * the file the README points people at keeps serving the previous app.
 *
 * So rebuild the standalone from the current source and compare. Together the
 * two checks close the loop: the standalone matches source, RouletteTracker.html
 * matches the standalone, therefore both ship the current app.
 *
 * The build goes to a throwaway directory rather than `standalone/`, so running
 * this never rewrites a committed file out from under you.
 */

const root = resolve(import.meta.dirname, '..')
// Inside the project: Vite refuses to empty an outDir outside its root.
const TMP = '.standalone-check'
const tmpPath = resolve(root, TMP)
const COMMITTED = 'standalone/index.html'

const cleanup = () => rmSync(tmpPath, { recursive: true, force: true })

const committedPath = resolve(root, COMMITTED)
if (!existsSync(committedPath)) {
  console.error(`✗ ${COMMITTED} is missing — it is a committed build output, not a local artifact.`)
  process.exit(1)
}

let fresh
try {
  cleanup()
  execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'standalone', '--outDir', TMP],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  )
  fresh = readFileSync(resolve(tmpPath, 'index.html'))
} catch (err) {
  console.error(`✗ Could not rebuild the standalone bundle to compare against: ${err.message}`)
  cleanup()
  process.exit(1)
}

const committed = readFileSync(committedPath)
cleanup()

if (fresh.equals(committed)) {
  console.log(`✓ ${COMMITTED} is current with src/ (${Math.round(committed.length / 1024)} KB)`)
  process.exit(0)
}

console.error(`✗ ${COMMITTED} is stale — it does not match a build from the current src/.
  committed: ${committed.length} bytes
  rebuilt:   ${fresh.length} bytes

Almost always this means src/ changed without regenerating the single-file
builds. Rebuild and re-bake, then commit both:

  npm run build:standalone
  npm run bake -- path/to/roulette-tracker-backup.json

If src/ genuinely has not changed since ${COMMITTED} was committed, then the
bundle is not reproducing byte for byte across environments, and this check —
not the committed file — is what needs revisiting.
`)
process.exit(1)
