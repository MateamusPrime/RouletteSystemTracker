import type { MoneyManagementSystem } from './money'
import type { PlacementSystem } from './placement'
import { pocketsFor } from './roulette'
import { simulateCombo } from './simulation'
import type { SessionConfig, Spin } from './types'

/**
 * Batch testing: play a combo over thousands of fair spins to see how it holds
 * up beyond one lucky session. A live session of 20 spins says almost nothing;
 * a few hundred runs of a few hundred spins shows the shape of the thing —
 * including how often it busts and how wide the outcomes spread.
 */

/** Deterministic PRNG so a given seed always reproduces the same batch. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface MonteCarloOptions {
  runs: number
  spinsPerRun: number
  seed: number
  config: SessionConfig
}

export interface MonteCarloResult {
  runs: number
  spinsPerRun: number
  /** Profit of each run, sorted ascending — the raw distribution. */
  profits: number[]
  mean: number
  median: number
  p5: number
  p25: number
  p75: number
  p95: number
  best: number
  worst: number
  /** Share of runs that finished in profit. */
  winRate: number
  /** Share of runs whose bankroll hit zero at some point. */
  bustRate: number
  /** Share of runs that ran out of money to cover the next required bet. */
  ruinRate: number
  /** Share of runs that broke a table limit at least once. */
  limitRate: number
  meanStaked: number
  meanMaxDrawdown: number
  /** What the house edge alone predicts for the average run. */
  expectedProfit: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]
}

/** Generates one run's worth of fair, independent spins. */
function randomSpins(rand: () => number, count: number, config: SessionConfig): Spin[] {
  const pockets = pocketsFor(config.wheelType)
  const spins: Spin[] = new Array(count)
  for (let i = 0; i < count; i++) {
    spins[i] = { n: pockets[Math.floor(rand() * pockets.length)], ts: 0 }
  }
  return spins
}

/** Yields to the browser so long batches keep the UI responsive. */
const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export async function runMonteCarlo(
  placement: PlacementSystem,
  money: MoneyManagementSystem<any>,
  options: MonteCarloOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<MonteCarloResult> {
  const { runs, spinsPerRun, seed, config } = options
  const rand = mulberry32(seed)
  const profits: number[] = []
  let busts = 0
  let ruined = 0
  let limitBreaks = 0
  let stakedTotal = 0
  let drawdownTotal = 0

  for (let i = 0; i < runs; i++) {
    const spins = randomSpins(rand, spinsPerRun, config)
    const result = simulateCombo(placement, money, spins, config)
    profits.push(result.profit)
    if (result.busted) busts++
    if (result.ruinedAt !== null) ruined++
    if (result.limitBreaches > 0) limitBreaks++
    stakedTotal += result.totalStaked
    drawdownTotal += result.maxDrawdown

    // Breathe every so often so the progress bar can paint.
    if (i % 25 === 24) {
      onProgress?.(i + 1, runs)
      await yieldToUi()
    }
  }
  onProgress?.(runs, runs)

  const sorted = [...profits].sort((a, b) => a - b)
  const mean = profits.reduce((s, v) => s + v, 0) / Math.max(profits.length, 1)
  const edge = config.wheelType === 'american' ? 2 / 38 : 1 / 37
  const meanStaked = stakedTotal / Math.max(runs, 1)

  return {
    runs,
    spinsPerRun,
    profits: sorted,
    mean,
    median: percentile(sorted, 0.5),
    p5: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    best: sorted[sorted.length - 1] ?? 0,
    worst: sorted[0] ?? 0,
    winRate: profits.filter(p => p > 0).length / Math.max(profits.length, 1),
    bustRate: busts / Math.max(runs, 1),
    ruinRate: ruined / Math.max(runs, 1),
    limitRate: limitBreaks / Math.max(runs, 1),
    meanStaked,
    meanMaxDrawdown: drawdownTotal / Math.max(runs, 1),
    expectedProfit: -meanStaked * edge,
  }
}

/** Buckets the profit distribution for a histogram. */
export function histogram(profits: number[], buckets = 24): { x: number; count: number }[] {
  if (profits.length === 0) return []
  const min = profits[0]
  const max = profits[profits.length - 1]
  if (max === min) return [{ x: min, count: profits.length }]
  const width = (max - min) / buckets
  const bins = Array.from({ length: buckets }, (_, i) => ({ x: min + width * (i + 0.5), count: 0 }))
  for (const p of profits) {
    const idx = Math.min(buckets - 1, Math.floor((p - min) / width))
    bins[idx].count++
  }
  return bins
}
