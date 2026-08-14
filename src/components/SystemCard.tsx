import type { SystemSummary } from '../domain/summary'

interface Props {
  title: string
  summary?: SystemSummary
  /** Plain-text fallback for built-in systems that have no structured summary. */
  fallback: string
}

/**
 * The contents of a system hover card. A step machine crammed into one
 * paragraph is unreadable, so steps get numbered rows, bets get chips, and
 * routes get their own arrow pills.
 */
export function SystemCard({ title, summary, fallback }: Props) {
  // A long machine overflows the card; say so rather than hiding it.
  const scrollable = (summary?.steps?.length ?? 0) > 3 || (summary?.facts?.length ?? 0) > 8
  return (
    <div className="syscard">
      <div className="syscard-head">
        <span className="syscard-title">{title}</span>
        {summary?.badge && <span className="syscard-badge">{summary.badge}</span>}
      </div>

      {summary?.intro && <p className="syscard-intro">{summary.intro}</p>}
      {!summary && <p className="syscard-body">{fallback}</p>}

      {summary?.steps && (
        <ol className="syscard-steps">
          {summary.steps.map((step, i) => (
            <li key={i}>
              <div className="syscard-step-head">
                <span className="syscard-step-no">{i + 1}</span>
                <span className="syscard-step-name">{step.name}</span>
                {step.funding && <span className="syscard-funding">{step.funding}</span>}
              </div>
              <div className="syscard-chips">
                {step.bets.length === 0 ? (
                  <span className="muted">no bets placed</span>
                ) : (
                  step.bets.map((bet, bi) => (
                    <span className="syscard-chip" key={bi}>
                      {bet}
                    </span>
                  ))
                )}
              </div>
              {step.routes.length > 0 && (
                <div className="syscard-routes">
                  {step.routes.map((route, ri) => (
                    <span
                      className={`syscard-route ${route.isRestart ? 'restart' : 'advance'}`}
                      key={ri}
                    >
                      <span className="syscard-route-when">{route.when}</span>
                      <span className="syscard-route-arrow">→</span>
                      <span className="syscard-route-then">{route.then}</span>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {summary?.facts && (
        <dl className="syscard-facts">
          {summary.facts.map((fact, i) => (
            <div key={i}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {summary?.note && <p className="syscard-note">{summary.note}</p>}
      {scrollable && (
        <div className="syscard-scrollhint">Scroll for the rest ↓</div>
      )}
    </div>
  )
}
