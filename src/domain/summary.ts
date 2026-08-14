/**
 * Structured system summaries. Cramming a step machine into one paragraph
 * produces an unreadable wall of text, so systems describe themselves as data
 * and the UI lays it out.
 */

export interface SummaryRoute {
  /** "2 of 3 win" */
  when: string
  /** "Step 3" or "restart" */
  then: string
  /** True when this route leaves the machine at its opening bet. */
  isRestart: boolean
}

export interface SummaryStep {
  name: string
  /** Bet labels, rendered as chips. */
  bets: string[]
  /** Funding note, e.g. "carries the win, pockets 2u first". */
  funding?: string
  routes: SummaryRoute[]
}

export interface SummaryFact {
  label: string
  value: string
}

export interface SystemSummary {
  /** Short pill shown beside the title, e.g. "Step system · 3 steps". */
  badge?: string
  /** The author's own description, if they wrote one. */
  intro?: string
  steps?: SummaryStep[]
  facts?: SummaryFact[]
  /** Extra context, e.g. how an overlay is applied. */
  note?: string
}

export function plainSummary(badge: string, intro: string): SystemSummary {
  return { badge, intro }
}
