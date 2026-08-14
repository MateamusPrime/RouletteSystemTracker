import { describe, expect, it } from 'vitest'
import {
  DOUBLE_ZERO,
  colorOf,
  columnOf,
  dozenOf,
  isZero,
  labelOf,
  pocketsFor,
  wheelOrder,
} from '../roulette'

describe('wheel basics', () => {
  it('colors the pockets the way a real wheel does', () => {
    expect(colorOf(1)).toBe('red')
    expect(colorOf(2)).toBe('black')
    expect(colorOf(0)).toBe('green')
    expect(colorOf(DOUBLE_ZERO)).toBe('green')
    // The high reds break the odd/even pattern — a classic source of bugs.
    expect(colorOf(19)).toBe('red')
    expect(colorOf(28)).toBe('black')
  })

  it('labels 00 rather than showing its internal 37', () => {
    expect(labelOf(DOUBLE_ZERO)).toBe('00')
    expect(labelOf(0)).toBe('0')
    expect(labelOf(17)).toBe('17')
  })

  it('treats both zeros as zero', () => {
    expect(isZero(0)).toBe(true)
    expect(isZero(DOUBLE_ZERO)).toBe(true)
    expect(isZero(1)).toBe(false)
  })

  it('assigns dozens and columns, with zeros outside both', () => {
    expect(dozenOf(1)).toBe(1)
    expect(dozenOf(12)).toBe(1)
    expect(dozenOf(13)).toBe(2)
    expect(dozenOf(36)).toBe(3)
    expect(dozenOf(0)).toBe(0)

    expect(columnOf(1)).toBe(1)
    expect(columnOf(2)).toBe(2)
    expect(columnOf(3)).toBe(3)
    expect(columnOf(34)).toBe(1)
    expect(columnOf(36)).toBe(3)
    expect(columnOf(DOUBLE_ZERO)).toBe(0)
  })

  it('has 37 pockets in Europe and 38 in America', () => {
    expect(pocketsFor('european')).toHaveLength(37)
    expect(pocketsFor('american')).toHaveLength(38)
    expect(pocketsFor('american')).toContain(DOUBLE_ZERO)
    expect(pocketsFor('european')).not.toContain(DOUBLE_ZERO)
  })

  it('uses physical wheel orders with every pocket exactly once', () => {
    for (const wheel of ['european', 'american'] as const) {
      const order = wheelOrder(wheel)
      const expected = pocketsFor(wheel)
      expect(order).toHaveLength(expected.length)
      expect(new Set(order).size).toBe(expected.length)
      for (const n of expected) expect(order).toContain(n)
    }
  })
})
