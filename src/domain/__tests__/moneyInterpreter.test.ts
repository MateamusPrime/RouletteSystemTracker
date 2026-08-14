import { describe, expect, it } from 'vitest'
import { buildMoneySystem, describeMoneyDef } from '../custom/moneyInterpreter'
import type { MoneyDef, MoneyGuardsDef } from '../custom/types'
import type { MoneyManagementSystem } from '../money'
import type { SpinOutcome } from '../types'

const noGuards: MoneyGuardsDef = {
  stopWinUnits: null,
  stopLossUnits: null,
  aheadFactor: 1,
  behindFactor: 1,
}

function progression(over: Partial<MoneyDef & { mode: 'progression' }> = {}): MoneyDef {
  return {
    id: 'p',
    name: 'P',
    description: '',
    mode: 'progression',
    start: 1,
    onWin: { op: 'reset', value: 1 },
    onLoss: { op: 'multiply', value: 2 },
    winStreakReset: 0,
    cap: 256,
    ...over,
  } as MoneyDef
}

/**
 * Plays a system against a scripted win/loss script for an even-money bet,
 * returning the stake used on each spin (in units).
 */
function stakes(system: MoneyManagementSystem<any>, script: SpinOutcome[]): number[] {
  let state = system.initial()
  const used: number[] = []
  for (const outcome of script) {
    const stake = system.multiplier(state)
    used.push(stake)
    const net = outcome === 'win' ? stake : outcome === 'loss' ? -stake : 0
    state = system.next(state, outcome, net)
  }
  return used
}

const L: SpinOutcome = 'loss'
const W: SpinOutcome = 'win'

describe('progression styles', () => {
  it('doubles after a loss and resets after a win (Martingale)', () => {
    const sys = buildMoneySystem(progression())
    expect(stakes(sys, [L, L, L, W, L])).toEqual([1, 2, 4, 8, 1])
  })

  it("adds and subtracts a unit (D'Alembert)", () => {
    const sys = buildMoneySystem(
      progression({ onWin: { op: 'subtract', value: 1 }, onLoss: { op: 'add', value: 1 } }),
    )
    // Never drops below the 0.1 floor after a win at the bottom.
    expect(stakes(sys, [L, L, W, W])).toEqual([1, 2, 3, 2])
  })

  it('resets after a winning streak (Paroli)', () => {
    const sys = buildMoneySystem(
      progression({
        onWin: { op: 'multiply', value: 2 },
        onLoss: { op: 'reset', value: 1 },
        winStreakReset: 3,
      }),
    )
    expect(stakes(sys, [W, W, W, W])).toEqual([1, 2, 4, 1])
  })

  it('honours the stake cap', () => {
    const sys = buildMoneySystem(progression({ cap: 4 }))
    expect(stakes(sys, [L, L, L, L, L])).toEqual([1, 2, 4, 4, 4])
  })

  it('adds a unit on every spin regardless of outcome', () => {
    const sys = buildMoneySystem(
      progression({ onWin: { op: 'add', value: 1 }, onLoss: { op: 'add', value: 1 } }),
    )
    expect(stakes(sys, [L, W, L, W, W])).toEqual([1, 2, 3, 4, 5])
  })
})

describe('ladder and cancellation styles', () => {
  it('steps through a fixed ladder and restarts at the end', () => {
    const sys = buildMoneySystem({
      id: 's',
      name: 'S',
      description: '',
      mode: 'sequence',
      sequence: [1, 3, 2, 6],
      onWin: { op: 'forward', steps: 1 },
      onLoss: { op: 'reset', steps: 1 },
      endBehavior: 'reset',
      cap: 256,
    })
    expect(stakes(sys, [W, W, W, W, W])).toEqual([1, 3, 2, 6, 1])
    expect(stakes(sys, [W, W, L, W])).toEqual([1, 3, 2, 1])
  })

  it('stakes first + last of a cancellation line and cancels on a win', () => {
    const sys = buildMoneySystem({
      id: 'c',
      name: 'C',
      description: '',
      mode: 'cancellation',
      line: [1, 2, 3, 4],
      cap: 256,
    })
    // 1+4=5; win crosses both off leaving 2-3 => 5; win again empties and resets.
    expect(stakes(sys, [W, W, W])).toEqual([5, 5, 5])
    // A loss appends the stake: line becomes 1-2-3-4-5 => next stake 1+5=6.
    expect(stakes(sys, [L, L])).toEqual([5, 6])
  })

  it('jumps between stakes in a step machine', () => {
    const sys = buildMoneySystem({
      id: 'm',
      name: 'M',
      description: '',
      mode: 'steps',
      steps: [
        { mult: 1, onWin: 'stay', onLoss: 1 },
        { mult: 5, onWin: 0, onLoss: 'stay' },
      ],
      cap: 256,
    })
    expect(stakes(sys, [W, L, L, W, W])).toEqual([1, 1, 5, 5, 1])
  })
})

describe('session guards', () => {
  it('walks away for good once the profit target is reached', () => {
    const sys = buildMoneySystem(
      progression({
        onWin: { op: 'hold', value: 1 },
        onLoss: { op: 'hold', value: 1 },
        guards: { ...noGuards, stopWinUnits: 2 },
      }),
    )
    // Two wins reach +2 units; every stake afterwards is zero (sitting out).
    expect(stakes(sys, [W, W, W, W])).toEqual([1, 1, 0, 0])
  })

  it('walks away at the stop loss', () => {
    const sys = buildMoneySystem(
      progression({
        onWin: { op: 'hold', value: 1 },
        onLoss: { op: 'hold', value: 1 },
        guards: { ...noGuards, stopLossUnits: 2 },
      }),
    )
    expect(stakes(sys, [L, L, L, L])).toEqual([1, 1, 0, 0])
  })

  it('scales the stake while ahead or behind', () => {
    const sys = buildMoneySystem(
      progression({
        onWin: { op: 'hold', value: 1 },
        onLoss: { op: 'hold', value: 1 },
        guards: { ...noGuards, aheadFactor: 2, behindFactor: 0.5 },
      }),
    )
    // Spin 1 flat; after a win we are ahead (x2); after that loss we are level.
    expect(stakes(sys, [W, L])).toEqual([1, 2])
    expect(stakes(sys, [L, L])).toEqual([1, 0.5])
  })
})

describe('bank and reset cycles', () => {
  const climb = (basis: 'milestones' | 'from-cycle-start') =>
    buildMoneySystem(
      progression({
        onWin: { op: 'add', value: 1 },
        onLoss: { op: 'add', value: 1 },
        guards: { ...noGuards, cycleTargetUnits: 10, cycleBasis: basis },
      }),
    )

  it('resets the progression when a cycle hits its target', () => {
    // Stakes climb 1,2,3,4,5; profits -1,1,4,8,13 -> crosses +10 on spin 5.
    expect(stakes(climb('milestones'), [L, W, W, W, W, W, W])).toEqual([
      1, 2, 3, 4, 5, 1, 2,
    ])
  })

  it('keeps fixed milestones so an overshoot counts toward the next target', () => {
    const sys = climb('milestones')
    let state = sys.initial()
    const script: SpinOutcome[] = [L, W, W, W, W]
    for (const outcome of script) {
      const stake = sys.multiplier(state)
      state = sys.next(state, outcome, outcome === 'win' ? stake : -stake)
    }
    // Overshot to +13; next milestone stays at +20 total, so cycleStart = 10.
    expect(state.profit).toBe(13)
    expect(state.cycleStart).toBe(10)
    expect(state.cyclesDone).toBe(1)
  })

  it('carries the overshoot when asked to', () => {
    const sys = climb('from-cycle-start')
    let state = sys.initial()
    const script: SpinOutcome[] = [L, W, W, W, W]
    for (const outcome of script) {
      const stake = sys.multiplier(state)
      state = sys.next(state, outcome, outcome === 'win' ? stake : -stake)
    }
    // Next cycle needs a full 10 from +13, so cycleStart moves to 13.
    expect(state.cycleStart).toBe(13)
  })

  it('stops for good after the cycle limit', () => {
    const sys = buildMoneySystem(
      progression({
        onWin: { op: 'hold', value: 1 },
        onLoss: { op: 'hold', value: 1 },
        guards: { ...noGuards, cycleTargetUnits: 1, maxCycles: 2 },
      }),
    )
    expect(stakes(sys, [W, W, W, W])).toEqual([1, 1, 0, 0])
  })
})

describe('generated progression summaries', () => {
  it('describes a climb-and-bank system in plain English', () => {
    const text = describeMoneyDef(
      progression({
        onWin: { op: 'add', value: 1 },
        onLoss: { op: 'add', value: 1 },
        guards: { ...noGuards, cycleTargetUnits: 10, stopWinUnits: 40 },
      }),
    )
    expect(text).toContain('Progression starting at 1u')
    expect(text).toContain('After a win: +1u')
    expect(text).toContain('Banks and resets each time a cycle gains 10u')
    expect(text).toContain('Walks away at +40u profit')
  })
})
