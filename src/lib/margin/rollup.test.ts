import { describe, it, expect } from 'vitest'
import { rollUp } from './rollup'

describe('rollUp', () => {
  it('groups rows by label and sums revenue/cost', () => {
    const result = rollUp([
      { label: 'SKU-A', revenue: 100, cost: 60 },
      { label: 'SKU-A', revenue: 50, cost: 30 },
      { label: 'SKU-B', revenue: 200, cost: 150 },
    ])

    expect(result).toHaveLength(2)
    const skuA = result.find((r) => r.label === 'SKU-A')
    const skuB = result.find((r) => r.label === 'SKU-B')
    expect(skuA).toMatchObject({ revenue: 150, cost: 90 })
    expect(skuB).toMatchObject({ revenue: 200, cost: 150 })
  })

  it('sorts descending by revenue', () => {
    const result = rollUp([
      { label: 'small', revenue: 10, cost: 5 },
      { label: 'big', revenue: 1000, cost: 500 },
      { label: 'medium', revenue: 100, cost: 50 },
    ])

    expect(result.map((r) => r.label)).toEqual(['big', 'medium', 'small'])
  })

  it('returns an empty array for no rows', () => {
    expect(rollUp([])).toEqual([])
  })

  it('handles a single row without grouping', () => {
    const result = rollUp([{ label: 'only-one', revenue: 42, cost: 10 }])
    expect(result).toEqual([{ key: 'only-one', label: 'only-one', revenue: 42, cost: 10 }])
  })
})
