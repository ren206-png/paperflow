import { describe, it, expect } from 'vitest'
import { totalUnitCost, marginPct, type LatestCostInput } from './resolve'

describe('totalUnitCost', () => {
  it('sums all four cost components', () => {
    const ci: LatestCostInput = {
      raw_material_cost: 1.2,
      packaging_cost: 0.3,
      labor_cost: 0.4,
      freight_cost_per_unit: 0.1,
      effective_date: '2026-01-01',
    }
    expect(totalUnitCost(ci)).toBeCloseTo(2.0)
  })

  it('handles all-zero cost components', () => {
    const ci: LatestCostInput = {
      raw_material_cost: 0,
      packaging_cost: 0,
      labor_cost: 0,
      freight_cost_per_unit: 0,
      effective_date: '2026-01-01',
    }
    expect(totalUnitCost(ci)).toBe(0)
  })
})

describe('marginPct', () => {
  it('computes standard margin percentage', () => {
    // ($10 price - $6 cost) / $10 = 40%
    expect(marginPct(10, 6)).toBe(40)
  })

  it('rounds to one decimal place', () => {
    // (10 - 6.666...) / 10 = 33.33...% -> rounds to 33.3
    expect(marginPct(10, 6.6667)).toBe(33.3)
  })

  it('returns 0 when unit price is 0 (avoids divide-by-zero)', () => {
    expect(marginPct(0, 5)).toBe(0)
  })

  it('returns 100 when cost is 0', () => {
    expect(marginPct(10, 0)).toBe(100)
  })

  it('returns a negative margin when cost exceeds price', () => {
    // ($10 price - $15 cost) / $10 = -50%
    expect(marginPct(10, 15)).toBe(-50)
  })
})
