import type { TraceEntry } from './simulation'

/**
 * A stretch of spins sharing one condition, drawn as a shaded region with a
 * line at each edge. Ranges are inclusive and 1-based, matching spin numbers.
 */
export interface TimelineBand {
  kind: 'capped' | 'raised' | 'unaffordable' | 'ruined' | 'stopped'
  from: number
  to: number
  label: string
}

/**
 * Groups the spins matching `test` into contiguous runs. One band per run
 * rather than one per spin, so a system capped for twenty spins reads as a
 * single region instead of twenty stripes.
 */
export function contiguousBands(
  count: number,
  test: (i: number) => boolean,
  kind: TimelineBand['kind'],
  label: string,
): TimelineBand[] {
  const bands: TimelineBand[] = []
  let start: number | null = null
  for (let i = 0; i < count; i++) {
    if (test(i)) {
      if (start === null) start = i
    } else if (start !== null) {
      bands.push({ kind, label, from: start + 1, to: i })
      start = null
    }
  }
  if (start !== null) bands.push({ kind, label, from: start + 1, to: count })
  return bands
}

/** True when the table forced any bet on this spin DOWN to the ceiling. */
function wasCapped(t: TraceEntry): boolean {
  return (
    (t.caps?.length ?? 0) > 0 ||
    t.bets.some(b => b.requested !== undefined && b.amount < b.requested)
  )
}

/** True when any bet had to be lifted UP to the table minimum. */
function wasRaised(t: TraceEntry): boolean {
  return (
    (t.raises?.length ?? 0) > 0 ||
    t.bets.some(b => b.requested !== undefined && b.amount > b.requested)
  )
}

/** True when the spin was skipped because the bankroll could not cover it. */
function wasUnaffordable(t: TraceEntry): boolean {
  return t.violations.some(v => v.includes('bet not placed'))
}

/**
 * Every shaded region for one combo's session: where its bets were cut down to
 * the table, where it could not cover the stake, and the dead air after it ran
 * out of money or walked away.
 */
export function bandsForTrace(
  trace: TraceEntry[],
  ruinedAt: number | null,
  stoppedAt: number | null = null,
): TimelineBand[] {
  const n = trace.length
  const bands = [
    ...contiguousBands(n, i => wasCapped(trace[i]), 'capped', 'cut to table max'),
    ...contiguousBands(n, i => wasRaised(trace[i]), 'raised', 'lifted to table min'),
    ...contiguousBands(n, i => wasUnaffordable(trace[i]), 'unaffordable', 'could not cover'),
  ]
  // The tail after the session effectively ended is one region, not a run of
  // individually-flagged spins.
  if (ruinedAt !== null && ruinedAt <= n) {
    bands.push({ kind: 'ruined', label: 'out of money', from: ruinedAt, to: n })
  } else if (stoppedAt !== null && stoppedAt <= n) {
    bands.push({ kind: 'stopped', label: 'walked away', from: stoppedAt, to: n })
  }
  return bands
}

/**
 * The same regions for the follow-the-leaderboard model, whose steps record
 * skips and ruin as notes rather than table violations.
 */
export function bandsForFollowSteps(
  steps: { note: string | null; bets: { amount: number; requested?: number }[] }[],
  ruinedAt: number | null,
): TimelineBand[] {
  const n = steps.length
  const bands = [
    ...contiguousBands(
      n,
      i => steps[i].bets.some(b => b.requested !== undefined && b.amount < b.requested),
      'capped',
      'cut to table max',
    ),
    ...contiguousBands(
      n,
      i => steps[i].bets.some(b => b.requested !== undefined && b.amount > b.requested),
      'raised',
      'lifted to table min',
    ),
    ...contiguousBands(
      n,
      i => steps[i].note?.includes('skipped, still playing') === true,
      'unaffordable',
      'could not afford',
    ),
  ]
  if (ruinedAt !== null && ruinedAt <= n) {
    bands.push({ kind: 'ruined', label: 'out of money', from: ruinedAt, to: n })
  }
  return bands
}
