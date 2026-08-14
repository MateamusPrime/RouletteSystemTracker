import type { TimelineBand } from '../domain/timelineBands'

interface Props {
  series: number[]
  baseline: number
  width?: number
  height?: number
  /** Shaded regions (capped / unaffordable / ruined), in 1-based spin numbers. */
  bands?: TimelineBand[]
}

export function Sparkline({ series, baseline, width = 260, height = 60, bands }: Props) {
  if (series.length < 2) {
    return <div className="sparkline-empty muted">No spins yet</div>
  }
  const min = Math.min(...series, baseline)
  const max = Math.max(...series, baseline)
  const span = max - min || 1
  const x = (i: number) => (i / (series.length - 1)) * width
  const y = (v: number) => height - ((v - min) / span) * height
  const path = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = series[series.length - 1]
  const up = last >= baseline

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
    >
      {/* Same regions as the full timeline, so both visuals tell one story. */}
      {bands?.map(b => {
        const x1 = x(Math.max(b.from - 1, 0))
        const x2 = x(Math.min(b.to, series.length - 1))
        return (
          <g key={`${b.kind}-${b.from}-${b.to}`}>
            <rect
              x={x1}
              y={0}
              width={Math.max(x2 - x1, 0.5)}
              height={height}
              className={`timeline-band ${b.kind}`}
            />
            <line x1={x1} x2={x1} y1={0} y2={height} className={`timeline-band-edge ${b.kind}`} />
            <line x1={x2} x2={x2} y1={0} y2={height} className={`timeline-band-edge ${b.kind}`} />
          </g>
        )
      })}
      <line
        x1={0}
        x2={width}
        y1={y(baseline)}
        y2={y(baseline)}
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeDasharray="4 4"
      />
      <path
        d={path}
        fill="none"
        stroke={up ? 'var(--win)' : 'var(--loss)'}
        strokeWidth={2}
      />
    </svg>
  )
}
