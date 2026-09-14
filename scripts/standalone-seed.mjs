/**
 * Where the baked seed lives inside the standalone HTML.
 *
 * `bake-standalone.mjs` writes the seed in; `check-standalone-sync.mjs` takes it
 * back out to compare the app code underneath. Both go through this module so
 * they can never disagree about the boundary — a disagreement would make the
 * sync check quietly compare the wrong bytes.
 */

/**
 * The seed is always the FIRST script in the file: bake injects it ahead of the
 * app script so the first render already sees the data. It opens with a bare
 * `<script>` + IIFE, which is what distinguishes it from Vite's
 * `<script type="module">` app bundle.
 */
export const SEED_START = '<script>(function(){'
export const SEED_END = '})()</script>'

/** Offset of the first script tag — where a seed goes, and where one begins. */
function firstScriptAt(html) {
  return html.indexOf('<script')
}

/**
 * Inserts a seed bootstrap ahead of the app script.
 * Returns the new HTML, or null if there is no script tag to seed ahead of.
 */
export function injectSeed(html, bootstrap) {
  const at = firstScriptAt(html)
  if (at === -1) return null
  return html.slice(0, at) + bootstrap + html.slice(at)
}

/**
 * Splits a standalone HTML file into its baked seed and the app code under it.
 *
 * Returns `{ seed, app }`, where `seed` is null for an unbaked file (then `app`
 * is the whole input). Throws only when a file starts a seed and never ends it,
 * which means the file is truncated or hand-edited.
 *
 * `SEED_END` cannot appear inside the seed's own JSON — bake escapes `<` to
 * `<` — so the first match after the start is always the real end.
 */
export function splitSeed(html) {
  const at = firstScriptAt(html)
  if (at === -1 || !html.startsWith(SEED_START, at)) return { seed: null, app: html }

  const end = html.indexOf(SEED_END, at)
  if (end === -1) {
    throw new Error(`Found the start of a baked seed but no ${SEED_END} closing it.`)
  }

  const stop = end + SEED_END.length
  return { seed: html.slice(at, stop), app: html.slice(0, at) + html.slice(stop) }
}

/**
 * Escapes a seed's JSON so it cannot terminate the script tag that carries it.
 *
 * This is what makes splitting on SEED_END safe: with `<` escaped, neither
 * `</script>` nor SEED_END can appear literally inside the payload, so the
 * first SEED_END after the start is always the real one.
 */
export function escapeSeedJson(json) {
  return json.replaceAll('<', '\\u003c')
}

/** The seed's identity marker (`seed:<exportedAt>`), for reporting. Null if absent. */
export function seedIdOf(seed) {
  return seed?.match(/seed:[^'"]*/)?.[0] ?? null
}
