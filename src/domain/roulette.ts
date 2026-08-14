import type { WheelType } from './types'

/** 37 is used internally to represent "00" on American wheels. */
export const DOUBLE_ZERO = 37

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
])

export type PocketColor = 'red' | 'black' | 'green'

export function colorOf(n: number): PocketColor {
  if (n === 0 || n === DOUBLE_ZERO) return 'green'
  return RED_NUMBERS.has(n) ? 'red' : 'black'
}

export function labelOf(n: number): string {
  return n === DOUBLE_ZERO ? '00' : String(n)
}

export function pocketsFor(wheel: WheelType): number[] {
  const base = Array.from({ length: 37 }, (_, i) => i)
  return wheel === 'american' ? [...base, DOUBLE_ZERO] : base
}

export function isZero(n: number): boolean {
  return n === 0 || n === DOUBLE_ZERO
}

/** Dozen index 1..3, or 0 for zeros. */
export function dozenOf(n: number): number {
  if (isZero(n)) return 0
  return Math.ceil(n / 12)
}

/** Column index 1..3, or 0 for zeros. */
export function columnOf(n: number): number {
  if (isZero(n)) return 0
  const c = n % 3
  return c === 0 ? 3 : c
}

export const NUMBERS_BY_DOZEN: Record<number, number[]> = {
  1: Array.from({ length: 12 }, (_, i) => i + 1),
  2: Array.from({ length: 12 }, (_, i) => i + 13),
  3: Array.from({ length: 12 }, (_, i) => i + 25),
}

export const NUMBERS_BY_COLUMN: Record<number, number[]> = {
  1: Array.from({ length: 12 }, (_, i) => i * 3 + 1),
  2: Array.from({ length: 12 }, (_, i) => i * 3 + 2),
  3: Array.from({ length: 12 }, (_, i) => i * 3 + 3),
}

export const ALL_RED = [...RED_NUMBERS]
export const ALL_BLACK = Array.from({ length: 36 }, (_, i) => i + 1).filter(
  n => !RED_NUMBERS.has(n),
)
export const ALL_ODD = Array.from({ length: 18 }, (_, i) => i * 2 + 1)
export const ALL_EVEN = Array.from({ length: 18 }, (_, i) => (i + 1) * 2)
export const ALL_LOW = Array.from({ length: 18 }, (_, i) => i + 1)
export const ALL_HIGH = Array.from({ length: 18 }, (_, i) => i + 19)

/** Physical wheel order, used for sector-based stats and neighbour bets. */
export const EUROPEAN_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]

export const AMERICAN_WHEEL_ORDER = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37,
  27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
]

export function wheelOrder(wheel: WheelType): number[] {
  return wheel === 'american' ? AMERICAN_WHEEL_ORDER : EUROPEAN_WHEEL_ORDER
}

/** How many arcs the wheel is cut into for sector stats and sector bets. */
export const SECTOR_COUNT = 4
export const SECTOR_LABELS = ['Sector A', 'Sector B', 'Sector C', 'Sector D']

/**
 * The wheel cut into four arcs of as-equal size as 37 (or 38) pockets allow.
 *
 * The split has to be proportional rather than fixed-width: slicing 37 pockets
 * into chunks of ceil(37/4) leaves the last arc with only 7 pockets against 10
 * for the others, so it would hit 18.9% of the time against 27% and read as
 * permanently "cold" no matter what the wheel did.
 */
export function wheelSectors(wheel: WheelType): number[][] {
  const order = wheelOrder(wheel)
  const sectors: number[][] = Array.from({ length: SECTOR_COUNT }, () => [])
  order.forEach((n, i) => {
    sectors[Math.min(Math.floor((i * SECTOR_COUNT) / order.length), SECTOR_COUNT - 1)].push(n)
  })
  return sectors
}

/** Which arc a pocket sits in, 0-based. */
export function sectorOf(n: number, wheel: WheelType): number {
  const order = wheelOrder(wheel)
  const i = order.indexOf(n)
  if (i === -1) return 0
  return Math.min(Math.floor((i * SECTOR_COUNT) / order.length), SECTOR_COUNT - 1)
}
