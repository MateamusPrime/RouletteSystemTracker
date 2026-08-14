import { useMemo, useRef, useState } from 'react'
import { colorOf, labelOf } from '../domain/roulette'
import { bandsForTrace } from '../domain/timelineBands'
import type { TraceEntry } from '../domain/simulation'
import { BandLegend } from './BandLegend'

interface Props {
  trace: TraceEntry[]
  startingBankroll: number
  selected: number
  onSelect(index: number): void
  /** Spin the combo ran out of money, if it did. */
  ruinedAt: number | null
  /** Spin a win/loss guardrail ended the session, if one did. */
  stoppedAt?: number | null
}

const BAND_DETAIL: Record<string, string> = {
  capped: 'the table ceiling forced these bets smaller than the progression wanted',
  raised: 'these bets were below the table minimum and had to be lifted up to it',
  unaffordable: 'the bankroll could not cover the stake, so no bet was placed',
  ruined: 'out of money — stopped playing here',
  stopped: 'hit a win/loss guardrail and walked away',
}

const W = 1000
const H = 190

function money(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`
}

/**
 * The bankroll curve doubles as the session's scrubber: hover to read any
 * spin, click to jump to it. Replacing the old row-by-row table with this
 * keeps a 200-spin session readable in one glance.
 */
export function ComboTimeline({
  trace,
  startingBankroll,
  selected,
  onSelect,
  ruinedAt,
  stoppedAt = null,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  // The stretches that explain the shape of the curve, pinned permanently
  // rather than only being findable by scrubbing to the right spin.
  const bands = useMemo(
    () => bandsForTrace(trace, ruinedAt, stoppedAt),
    [trace, ruinedAt, stoppedAt],
  )

  const { path, xOf, yOf, min, max } = useMemo(() => {
    const values = [startingBankroll, ...trace.map(t => t.bankroll)]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    // Index 0 is the opening bankroll; spin i sits at index i + 1.
    const xOf = (i: number) => (values.length === 1 ? 0 : (i / (values.length - 1)) * W)
    const yOf = (v: number) => H - ((v - min) / span) * H
    const path = values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
      .join(' ')
    return { path, xOf, yOf, min, max }
  }, [trace, startingBankroll])

  if (trace.length === 0) return null

  /** Maps a pointer position to the nearest spin index. */
  const indexFromEvent = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return selected
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    return Math.min(trace.length - 1, Math.max(0, Math.round(fraction * trace.length) - 1))
  }

  const active = hover ?? selected
  const entry = trace[active]
  const baselineY = yOf(startingBankroll)
  // Position the read-out on whichever side keeps it inside the chart.
  const tipOnLeft = xOf(active + 1) > W * 0.6

  return (
    <div className="timeline">
      <svg
        ref={svgRef}
        className="timeline-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={e => setHover(indexFromEvent(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={e => onSelect(indexFromEvent(e.clientX))}
      >
        {/* Each region is shaded, with a hard line at the spin it starts and
            the spin it ends, so the extent is readable and not just a wash. */}
        {bands.map(b => {
          const x1 = xOf(b.from - 1)
          const x2 = xOf(b.to)
          return (
            <g key={`${b.kind}-${b.from}-${b.to}`}>
              <rect
                x={x1}
                y={0}
                width={Math.max(x2 - x1, 0.5)}
                height={H}
                className={`timeline-band ${b.kind}`}
              />
              <line
                x1={x1}
                x2={x1}
                y1={0}
                y2={H}
                className={`timeline-band-edge ${b.kind}`}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={x2}
                x2={x2}
                y1={0}
                y2={H}
                className={`timeline-band-edge ${b.kind}`}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
        <line x1={0} x2={W} y1={baselineY} y2={baselineY} className="timeline-baseline" />
        <path d={path} className="timeline-line" vectorEffect="non-scaling-stroke" />
        {/* Selected spin marker */}
        <line
          x1={xOf(selected + 1)}
          x2={xOf(selected + 1)}
          y1={0}
          y2={H}
          className="timeline-cursor selected"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && hover !== selected && (
          <line
            x1={xOf(hover + 1)}
            x2={xOf(hover + 1)}
            y1={0}
            y2={H}
            className="timeline-cursor"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Marker captions are HTML for the same reason as the axis labels: the
          SVG is stretched, so any text inside it would be squashed. */}
      {bands.map((b, i) => (
        <span
          key={`${b.kind}-${b.from}-${b.to}-label`}
          className={`timeline-band-tag ${b.kind} ${xOf(b.from - 1) > W * 0.72 ? 'flip' : ''}`}
          style={{
            left: `${(xOf(b.from - 1) / W) * 100}%`,
            // Stack overlapping regions so their captions stay readable.
            top: `${2 + (i % 3) * 12}px`,
          }}
          title={
            b.to > b.from
              ? `Spins ${b.from}–${b.to} — ${BAND_DETAIL[b.kind]}`
              : `Spin ${b.from} — ${BAND_DETAIL[b.kind]}`
          }
        >
          {b.label}
          {b.to > b.from && <span className="timeline-band-range"> {b.from}–{b.to}</span>}
        </span>
      ))}

      {/* Axis labels sit outside the stretched SVG so they are not distorted. */}
      <div className="timeline-scale">
        <span>{money(max)}</span>
        <span className="muted">start {money(startingBankroll)}</span>
        <span>{money(min)}</span>
      </div>

      {entry && (
        <div className={`timeline-readout ${tipOnLeft ? 'left' : 'right'}`}>
          <span className={`chip ${colorOf(entry.n)}`}>{labelOf(entry.n)}</span>
          <span className="timeline-readout-main">
            Spin {entry.index + 1}
            {entry.outcome === 'sit-out' ? (
              <span className="muted"> · no bet</span>
            ) : (
              <>
                {' · '}
                <span className={entry.net > 0 ? 'pos' : entry.net < 0 ? 'neg' : ''}>
                  {entry.net > 0 ? '+' : ''}
                  {money(entry.net)}
                </span>
                <span className="muted"> on {money(entry.staked)}</span>
              </>
            )}
          </span>
          <span className="muted">{money(entry.bankroll)}</span>
        </div>
      )}
      <BandLegend bands={bands} />

      <div className="timeline-hint muted">
        Hover to read any spin · click to open it · ←/→ step spins, ↑/↓ change combo
      </div>
    </div>
  )
}
