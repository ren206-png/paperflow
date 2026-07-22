import { describe, it, expect } from 'vitest'
import { ALERT_THRESHOLD_PCT, activeMarginAlerts, suggestedRepriceUnitPrice } from './alerts'
import type { MarginAlertReview, PriceBookLineMargin } from '@/types'

function line(overrides: Partial<PriceBookLineMargin> = {}): PriceBookLineMargin {
  return {
    price_book_line_id: 'line-1',
    price_book_id: 'book-1',
    product_id: 'product-1',
    unit_price: 100,
    min_qty: 1,
    max_qty: null,
    price_updated_at: '2026-07-01T00:00:00Z',
    organization_id: 'org-1',
    customer_id: null,
    price_book_name: 'Default',
    is_contract: false,
    current_unit_cost: 90,
    cost_effective_date: '2026-07-15',
    margin_pct: 10,
    ...overrides,
  }
}

function review(overrides: Partial<MarginAlertReview> = {}): MarginAlertReview {
  return {
    id: 'review-1',
    organization_id: 'org-1',
    price_book_line_id: 'line-1',
    reviewed_cost_effective_date: '2026-07-15',
    action: 'dismissed',
    previous_unit_price: 100,
    new_unit_price: null,
    reviewed_by: null,
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  }
}

describe('activeMarginAlerts', () => {
  it('includes lines below the threshold with no review', () => {
    const result = activeMarginAlerts([line({ margin_pct: ALERT_THRESHOLD_PCT - 1 })], [])
    expect(result).toHaveLength(1)
  })

  it('excludes lines at or above the threshold', () => {
    const result = activeMarginAlerts([line({ margin_pct: ALERT_THRESHOLD_PCT })], [])
    expect(result).toHaveLength(0)
  })

  it('excludes lines with no cost on file (null margin_pct)', () => {
    const result = activeMarginAlerts([line({ margin_pct: null, current_unit_cost: null })], [])
    expect(result).toHaveLength(0)
  })

  it('excludes a line already reviewed against the current cost snapshot', () => {
    const result = activeMarginAlerts(
      [line({ margin_pct: 5, cost_effective_date: '2026-07-15' })],
      [review({ reviewed_cost_effective_date: '2026-07-15' })]
    )
    expect(result).toHaveLength(0)
  })

  it('reappears once the cost changes again after a review', () => {
    const result = activeMarginAlerts(
      [line({ margin_pct: 5, cost_effective_date: '2026-07-20' })],
      [review({ reviewed_cost_effective_date: '2026-07-15' })]
    )
    expect(result).toHaveLength(1)
  })

  it('only considers the latest review per line (first match wins)', () => {
    const result = activeMarginAlerts(
      [line({ margin_pct: 5, cost_effective_date: '2026-07-15' })],
      [
        review({ reviewed_cost_effective_date: '2026-07-15' }),
        review({ reviewed_cost_effective_date: '2026-06-01' }),
      ]
    )
    expect(result).toHaveLength(0)
  })

  it('sorts ascending by margin_pct (worst first)', () => {
    const result = activeMarginAlerts(
      [
        line({ price_book_line_id: 'a', margin_pct: 12 }),
        line({ price_book_line_id: 'b', margin_pct: 2 }),
        line({ price_book_line_id: 'c', margin_pct: 8 }),
      ],
      []
    )
    expect(result.map((l) => l.price_book_line_id)).toEqual(['b', 'c', 'a'])
  })
})

describe('suggestedRepriceUnitPrice', () => {
  it('computes the price that hits the target margin', () => {
    expect(suggestedRepriceUnitPrice(80, 20)).toBe(100)
  })

  it('returns cost unchanged when target margin is 0', () => {
    expect(suggestedRepriceUnitPrice(50, 0)).toBe(50)
  })

  it('falls back to cost when target margin is 100 or more', () => {
    expect(suggestedRepriceUnitPrice(50, 100)).toBe(50)
    expect(suggestedRepriceUnitPrice(50, 150)).toBe(50)
  })

  it('falls back to cost for a non-finite target margin', () => {
    expect(suggestedRepriceUnitPrice(50, NaN)).toBe(50)
  })
})
