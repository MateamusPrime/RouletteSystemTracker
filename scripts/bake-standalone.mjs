import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Bakes a backup into the standalone HTML so the file opens with the systems
 * and sessions already present.
 *
 *   node scripts/bake-standalone.mjs <backup.json> [output.html]
 *
 * The seed is applied ONCE, guarded by a marker in local storage, and it merges
 * by id rather than overwriting. So it will not clobber work done in the file,
 * and it will not resurrect something deliberately deleted.
 */

const [, , backupPath, outPathArg] = process.argv
if (!backupPath) {
  console.error('usage: node scripts/bake-standalone.mjs <backup.json> [output.html]')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const builtPath = resolve(root, 'standalone/index.html')
const outPath = resolve(root, outPathArg ?? 'RouletteTracker.html')

const backup = JSON.parse(readFileSync(resolve(backupPath), 'utf8'))
if (backup.format !== 'roulette-system-tracker/backup') {
  console.error(`${backupPath} is not a Roulette System Tracker backup.`)
  process.exit(1)
}

const sessions = Array.isArray(backup.sessions) ? backup.sessions : []
const placements = backup.customSystems?.placements ?? []
const moneys = backup.customSystems?.moneys ?? []

// A marker derived from the export stamp, so re-baking a NEWER backup seeds
// again while re-opening the same file does not.
const seedId = `seed:${backup.exportedAt ?? 'unknown'}`

const seed = { sessions, customSystems: { placements, moneys }, seedId }

// `</script>` inside a string would end the tag early; escaping < prevents it.
const seedJson = JSON.stringify(seed).replace(/</g, '\\u003c')

const bootstrap = `<script>(function(){
  try {
    var seed = ${seedJson};
    var MARK = 'roulette-tracker:seeded';
    if (localStorage.getItem(MARK) === seed.seedId) return;
    var SES = 'roulette-tracker:sessions';
    var SYS = 'roulette-tracker:custom-systems';
    var read = function (k, fallback) {
      try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback } catch (e) { return fallback }
    };
    var byId = function (existing, incoming) {
      var ids = {};
      existing.forEach(function (x) { ids[x.id] = true });
      return existing.concat(incoming.filter(function (x) { return !ids[x.id] }));
    };
    var sessions = read(SES, []);
    var systems = read(SYS, { placements: [], moneys: [] });
    localStorage.setItem(SES, JSON.stringify(byId(sessions, seed.sessions)));
    localStorage.setItem(SYS, JSON.stringify({
      placements: byId(systems.placements || [], seed.customSystems.placements),
      moneys: byId(systems.moneys || [], seed.customSystems.moneys)
    }));
    localStorage.setItem(MARK, seed.seedId);
  } catch (e) {
    // A blocked storage API must not stop the app from loading.
    console.warn('Could not seed saved data:', e);
  }
})()</script>`

const html = readFileSync(builtPath, 'utf8')
// Seed before the app script runs, so the first render already sees the data.
const marker = '<script'
const at = html.indexOf(marker)
if (at === -1) {
  console.error('Could not find a script tag to seed ahead of.')
  process.exit(1)
}
writeFileSync(outPath, html.slice(0, at) + bootstrap + html.slice(at), 'utf8')

const kb = Math.round(Buffer.byteLength(readFileSync(outPath)) / 1024)
console.log(`Baked ${sessions.length} session(s), ${placements.length} placement system(s), ` +
  `${moneys.length} money system(s) into ${outPath} (${kb} KB)`)
console.log('Systems:', placements.map(p => p.name).join(', ') || '(none)')
