import { useCallback, useMemo, useRef, useState } from 'react'
import type { ComboResult } from '../domain/simulation'
import { useArrowKeys } from '../hooks/useKeyboardNav'
import { HoverCard } from './HoverCard'
import { SystemCard } from './SystemCard'

export interface LeaderboardFilters {
  placement: string
  money: string
  legalOnly: boolean
}

export const NO_FILTERS: LeaderboardFilters = { placement: '', money: '', legalOnly: false }

export function filtersActive(f: LeaderboardFilters): boolean {
  return f.placement !== '' || f.money !== '' || f.legalOnly
}

/** Applies the leaderboard's filters — shared so the recommendation agrees. */
export function applyFilters(results: ComboResult[], f: LeaderboardFilters): ComboResult[] {
  return results.filter(
    r =>
      (!f.legalOnly || r.limitBreaches === 0) &&
      (!f.placement || r.placementName === f.placement) &&
      // Matched on the plain plan name so a choice covers self-managed systems
      // too, which display theirs as "… (per cycle)".
      (!f.money || r.moneyBaseName === f.money),
  )
}

interface Props {
  results: ComboResult[]
  selectedKey: string | null
  onSelect(key: string): void
  filters: LeaderboardFilters
  onFiltersChange(filters: LeaderboardFilters): void
  comparedKey: string | null
  onCompare(key: string | null): void
}

export function comboKey(r: ComboResult): string {
  return `${r.placementId}::${r.moneyId}`
}

/** Spin-window choices for the Trend column; 15 balances signal vs recency. */
export const TREND_WINDOWS = [10, 15, 20, 25] as const
export const DEFAULT_TREND_WINDOW = 15

/**
 * Bankroll change over the last `n` recorded spins — a "heating up / cooling
 * down" read distinct from lifetime profit. Derived straight from the bankroll
 * curve, so it needs no extra simulation. A combo that is out of play has no
 * meaningful recent trend, so it reads as flat.
 */
export function trendOf(r: ComboResult, n: number): number {
  if (r.ruinedAt !== null || r.stoppedAt !== null) return 0
  const s = r.bankrollSeries
  const last = s.length - 1
  if (last <= 0) return 0
  return s[last] - s[Math.max(0, last - n)]
}

/**
 * Return per $100 put on the table. Raw profit rewards whoever staked the most,
 * so a combo pushing $90k across the felt outranks one that made nearly as much
 * from $1.4k — this separates how well a plan played from how much it risked.
 * A combo that never bet has no yield to report.
 */
export function profitPerHundred(r: ComboResult): number | null {
  if (r.totalStaked <= 0) return null
  return (r.profit / r.totalStaked) * 100
}

type SortKey =
  | 'rank' | 'placement' | 'money' | 'profit' | 'yield' | 'trend' | 'record' | 'winRate'
  | 'drawdown' | 'streak'

/** Value a column sorts on; strings sort A→Z, numbers high→low by default. */
const SORT_VALUE: Record<Exclude<SortKey, 'trend'>, (r: ComboResult) => number | string> = {
  rank: r => r.profit,
  placement: r => r.placementName,
  money: r => r.moneyName,
  profit: r => r.profit,
  // Combos that never bet sort to the bottom rather than floating on a null.
  yield: r => profitPerHundred(r) ?? -Infinity,
  record: r => r.wins - r.losses,
  winRate: r => r.wins / Math.max(1, r.wins + r.losses),
  drawdown: r => r.maxDrawdown,
  streak: r => r.currentStreak,
}

/** Columns that read better ascending on first click (lower is better). */
const ASCENDING_FIRST: SortKey[] = ['placement', 'money', 'drawdown']

/**
 * Row geometry for the virtualised list. These must match the CSS exactly —
 * the padding rows are computed from them, so a mismatch would drift the
 * scrollbar away from the content.
 */
const ROW_H = 30
const VIEWPORT_H = 420
const OVERSCAN = 8

function money(v: number): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(0)}`
}

export function Leaderboard({
  results,
  selectedKey,
  onSelect,
  filters,
  onFiltersChange,
  comparedKey,
  onCompare,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('profit')
  const [sortAsc, setSortAsc] = useState(false)
  const [trendWindow, setTrendWindow] = useState<number>(DEFAULT_TREND_WINDOW)
  // Only the rows on screen are rendered. The board grows every time a system
  // is added, and putting a thousand-plus rows in the DOM costs more than
  // simulating them does — so the window is the thing that has to scale.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const { legalOnly, placement: placementFilter, money: moneyFilter } = filters
  const setLegalOnly = (v: boolean) => onFiltersChange({ ...filters, legalOnly: v })
  const setPlacementFilter = (v: string) => onFiltersChange({ ...filters, placement: v })
  const setMoneyFilter = (v: string) => onFiltersChange({ ...filters, money: v })

  const breachCount = useMemo(
    () => results.filter(r => r.limitBreaches > 0).length,
    [results],
  )

  // Filter options come from the results themselves, so custom systems appear
  // automatically as they are created.
  const placementOptions = useMemo(
    () => [...new Set(results.map(r => r.placementName))].sort((a, b) => a.localeCompare(b)),
    [results],
  )
  const moneyOptions = useMemo(
    () => [...new Set(results.map(r => r.moneyBaseName))].sort((a, b) => a.localeCompare(b)),
    [results],
  )

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(a => !a)
    } else {
      setSortKey(key)
      setSortAsc(ASCENDING_FIRST.includes(key))
    }
  }

  const sorted = useMemo(() => {
    const rows = applyFilters(results, filters)
    const value = (r: ComboResult) =>
      sortKey === 'trend' ? trendOf(r, trendWindow) : SORT_VALUE[sortKey](r)
    rows.sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      const cmp =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv)
          : (av as number) - (bv as number)
      return sortAsc ? cmp : -cmp
    })
    return rows
  }, [results, sortKey, sortAsc, filters, trendWindow])

  /**
   * The slice of rows to actually render. Overscan keeps a buffer above and
   * below so a fast scroll does not show blank space before React catches up.
   */
  const window_ = useMemo(() => {
    const visible = Math.ceil(VIEWPORT_H / ROW_H)
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
    const end = Math.min(sorted.length, start + visible + OVERSCAN * 2)
    return { start, end, padTop: start * ROW_H, padBottom: (sorted.length - end) * ROW_H }
  }, [scrollTop, sorted.length])

  const filtered = filtersActive(filters)

  // Up/down walks the rows exactly as they are sorted and filtered on screen.
  const moveSelection = useCallback(
    (delta: number) => {
      if (sorted.length === 0) return
      const current = sorted.findIndex(r => comboKey(r) === selectedKey)
      const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), sorted.length - 1)
      onSelect(comboKey(sorted[next]))
      // The row being stepped onto may be outside the rendered window, so the
      // list is scrolled rather than relying on the element existing.
      const el = scrollRef.current
      if (!el) return
      const top = next * ROW_H
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW_H > el.scrollTop + VIEWPORT_H) el.scrollTop = top + ROW_H - VIEWPORT_H
    },
    [sorted, selectedKey, onSelect],
  )
  useArrowKeys(
    useMemo(
      () => ({ up: () => moveSelection(-1), down: () => moveSelection(1) }),
      [moveSelection],
    ),
  )

  const th = (key: SortKey, label: string, numeric = false) => (
    <th
      className={`sortable ${numeric ? 'num' : ''} ${sortKey === key ? 'sorted' : ''}`}
      onClick={() => toggleSort(key)}
      title={`Sort by ${label}`}
    >
      {label}
      <span className="sort-arrow">{sortKey === key ? (sortAsc ? '▲' : '▼') : '↕'}</span>
    </th>
  )

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <span className="panel-title">
          Combo Leaderboard ({filtered ? `${sorted.length} of ${results.length}` : results.length} combos)
        </span>
        <div className="leaderboard-controls">
          <label className="muted trend-window" title="How many recent spins the Trend column measures">
            Trend over last{' '}
            <select
              value={trendWindow}
              onChange={e => setTrendWindow(Number(e.target.value))}
            >
              {TREND_WINDOWS.map(n => (
                <option key={n} value={n}>{n} spins</option>
              ))}
            </select>
          </label>
          {breachCount > 0 && (
            <label className="muted" title="Hide combos whose bets broke the table minimum or maximum">
              <input
                type="checkbox"
                checked={legalOnly}
                onChange={e => setLegalOnly(e.target.checked)}
              />{' '}
              Table-legal only ({breachCount} flagged)
            </label>
          )}
          {filtered && (
            <button className="link" onClick={() => onFiltersChange(NO_FILTERS)}>
              Clear filters
            </button>
          )}
        </div>
      </div>
      <div
        className="table-scroll"
        ref={scrollRef}
        onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <table>
          <thead>
            <tr>
              {th('rank', '#')}
              {th('placement', 'Placement')}
              {th('money', 'Money Mgmt')}
              {th('profit', 'Profit', true)}
              {th('yield', 'Per $100', true)}
              {th('trend', `Trend (${trendWindow})`, true)}
              {th('record', 'W-L', true)}
              {th('winRate', 'Win %', true)}
              {th('drawdown', 'Max DD', true)}
              {th('streak', 'Streak', true)}
              <th title="Pin a second combo to compare against the selected one">vs</th>
            </tr>
            <tr className="filter-row">
              <th />
              <th>
                <select
                  value={placementFilter}
                  onChange={e => setPlacementFilter(e.target.value)}
                  title="Filter by betting system"
                >
                  <option value="">All betting systems</option>
                  {placementOptions.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </th>
              <th>
                <select
                  value={moneyFilter}
                  onChange={e => setMoneyFilter(e.target.value)}
                  title="Filter by money management"
                >
                  <option value="">All money systems</option>
                  {moneyOptions.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </th>
              <th colSpan={8} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  No combos match these filters.
                </td>
              </tr>
            )}
            {/* Spacers stand in for the rows above and below the window, so the
                scrollbar still reflects the full board. */}
            {window_.padTop > 0 && (
              <tr className="row-spacer" style={{ height: window_.padTop }} aria-hidden />
            )}
            {sorted.slice(window_.start, window_.end).map((r, offset) => {
              const i = window_.start + offset
              const key = comboKey(r)
              const decided = r.wins + r.losses
              const winPct = decided === 0 ? 0 : (r.wins / decided) * 100
              const per100 = profitPerHundred(r)
              const tr = trendOf(r, trendWindow)
              const avail = Math.max(0, r.bankrollSeries.length - 1)
              const effN = Math.min(trendWindow, avail)
              return (
                <tr
                  key={key}
                  className={key === selectedKey ? 'selected' : ''}
                  onClick={() => onSelect(key)}
                >
                  <td>{i + 1}</td>
                  <td>
                    <HoverCard
                      card={
                        <SystemCard
                          title={r.placementName}
                          summary={r.placementSummary}
                          fallback={r.placementDescription}
                        />
                      }
                    >
                      <span className="hover-name">{r.placementName}</span>
                    </HoverCard>
                    {r.ruinedAt !== null && (
                      <span
                        className="busted-tag"
                        title={
                          r.busted
                            ? `Bankroll gone on spin ${r.ruinedAt} — stopped playing there`
                            : `Could not cover its bet on spin ${r.ruinedAt} — stopped playing there`
                        }
                      >
                        {' '}OUT (spin {r.ruinedAt})
                      </span>
                    )}
                    {r.stoppedAt !== null && (
                      <span
                        className="stopped-tag"
                        title={`Walked away on spin ${r.stoppedAt} — ${r.stopReason}`}
                      >
                        {' '}✋ STOPPED (spin {r.stoppedAt})
                      </span>
                    )}
                    {r.limitBreaches > 0 && (
                      <span
                        className="limit-tag"
                        title={`${r.limitBreaches} spin(s) outside the table limits — ${r.firstBreach}`}
                      >
                        {' '}⚠ LIMITS
                      </span>
                    )}
                    {r.cappedSpins > 0 && (
                      <span
                        className="capped-tag"
                        title={`${r.cappedSpins} spin(s) cut down to the table maximum — ${r.firstCap}`}
                      >
                        {' '}▼ CUT TO MAX
                      </span>
                    )}
                    {r.raisedSpins > 0 && (
                      <span
                        className="raised-tag"
                        title={`${r.raisedSpins} spin(s) lifted up to the table minimum — ${r.firstRaise}`}
                      >
                        {' '}▲ MIN BET
                      </span>
                    )}
                  </td>
                  <td>
                    <HoverCard
                      card={
                        <SystemCard
                          title={r.moneyName}
                          summary={r.moneySummary}
                          fallback={r.moneyDescription}
                        />
                      }
                    >
                      <span className="hover-name">{r.moneyName}</span>
                    </HoverCard>
                  </td>
                  <td className={`num ${r.profit >= 0 ? 'pos' : 'neg'}`}>
                    {money(r.profit)}
                  </td>
                  <td
                    className={`num yield-cell ${
                      per100 === null ? 'muted' : per100 >= 0 ? 'pos' : 'neg'
                    }`}
                    title={
                      per100 === null
                        ? 'Never placed a bet, so there is no return to measure'
                        : `${money(r.profit)} profit on ${money(r.totalStaked)} staked — ${
                            per100 >= 0 ? 'made' : 'lost'
                          } $${Math.abs(per100).toFixed(2)} per $100 put on the table`
                    }
                  >
                    {per100 === null ? '—' : `${per100 >= 0 ? '+' : '-'}$${Math.abs(per100).toFixed(1)}`}
                  </td>
                  <td
                    className={`num trend-cell ${tr > 0 ? 'pos' : tr < 0 ? 'neg' : 'muted'}`}
                    title={
                      r.stoppedAt !== null
                        ? `Walked away on spin ${r.stoppedAt} — no recent trend`
                        : r.ruinedAt !== null
                          ? 'Out of play — no recent trend'
                          : `Bankroll ${tr >= 0 ? 'up' : 'down'} ${money(Math.abs(tr))} over the last ${effN} spin${effN === 1 ? '' : 's'}${effN < trendWindow ? ` (only ${effN} recorded)` : ''}`
                    }
                  >
                    {tr === 0 ? '–' : `${tr > 0 ? '▲' : '▼'} ${money(Math.abs(tr))}`}
                  </td>
                  <td className="num">
                    {r.wins}-{r.losses}
                    {r.sitOuts > 0 && <span className="muted"> ({r.sitOuts} out)</span>}
                  </td>
                  <td className="num">{winPct.toFixed(0)}%</td>
                  <td className="num">{money(r.maxDrawdown)}</td>
                  <td className={`num ${r.currentStreak > 0 ? 'pos' : r.currentStreak < 0 ? 'neg' : ''}`}>
                    {r.currentStreak > 0 ? `W${r.currentStreak}` : r.currentStreak < 0 ? `L${-r.currentStreak}` : '-'}
                  </td>
                  <td>
                    <button
                      className={`compare-pin ${key === comparedKey ? 'pinned' : ''}`}
                      title={key === comparedKey ? 'Remove from comparison' : 'Compare with the selected combo'}
                      onClick={e => {
                        e.stopPropagation()
                        onCompare(key === comparedKey ? null : key)
                      }}
                    >
                      {key === comparedKey ? '◆' : '◇'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {window_.padBottom > 0 && (
              <tr className="row-spacer" style={{ height: window_.padBottom }} aria-hidden />
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
