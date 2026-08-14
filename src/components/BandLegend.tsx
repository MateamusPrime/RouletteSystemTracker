import type { TimelineBand } from '../domain/timelineBands'

const DETAIL: Record<TimelineBand['kind'], string> = {
  capped: 'The table ceiling forced these bets smaller than the progression asked for.',
  raised: 'These bets were under the table minimum and had to be lifted up to it.',
  unaffordable: 'The bankroll could not cover the stake, so nothing was placed that spin.',
  ruined: 'Out of money — stopped playing from here.',
  stopped: 'Hit a win/loss guardrail and walked away from here.',
}

/**
 * Names the shaded regions on a timeline or sparkline. Only the kinds actually
 * present are listed, so a clean session shows nothing at all rather than a
 * legend for conditions that never happened.
 */
export function BandLegend({ bands }: { bands: TimelineBand[] }) {
  if (bands.length === 0) return null

  // One entry per kind, however many separate runs that kind has.
  const byKind = new Map<TimelineBand['kind'], { label: string; spins: number; runs: number }>()
  for (const b of bands) {
    const cur = byKind.get(b.kind) ?? { label: b.label, spins: 0, runs: 0 }
    cur.spins += b.to - b.from + 1
    cur.runs += 1
    byKind.set(b.kind, cur)
  }

  return (
    <div className="band-legend">
      {[...byKind].map(([kind, v]) => (
        <span className="band-legend-item" key={kind} title={DETAIL[kind]}>
          <span className={`band-legend-swatch ${kind}`} />
          {v.label}
          <span className="muted">
            {' '}· {v.spins} spin{v.spins === 1 ? '' : 's'}
            {v.runs > 1 ? ` in ${v.runs} stretches` : ''}
          </span>
        </span>
      ))}
    </div>
  )
}
