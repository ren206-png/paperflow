import { describe, it, expect, vi } from 'vitest'
import { resolvePriceBookId, resolveUnitPrice, getLatestCostInput } from './resolve'

// These wrappers exist solely to call fixed Postgres RPC names with the
// right argument shape — the actual resolution logic lives in the DB
// (see supabase/migrations/20260704004_price_books.sql and
// supabase/tests/pricing_rpcs.test.sql for the tier-matching behavior
// itself). What we're guarding here is that a rename/typo in the RPC
// name or argument keys doesn't silently ship.

function mockSupabase(returnValue: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(returnValue) } as unknown as Parameters<typeof resolvePriceBookId>[0]
}

describe('resolvePriceBookId', () => {
  it('calls the resolve_price_book RPC with customer id and as-of date', async () => {
    const supabase = mockSupabase({ data: 'book-123', error: null })
    const result = await resolvePriceBookId(supabase, 'cust-1', '2026-07-20')
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_price_book', {
      p_customer_id: 'cust-1',
      p_as_of: '2026-07-20',
    })
    expect(result).toBe('book-123')
  })

  it('throws when the RPC returns an error', async () => {
    const supabase = mockSupabase({ data: null, error: new Error('boom') })
    await expect(resolvePriceBookId(supabase, 'cust-1')).rejects.toThrow('boom')
  })
})

describe('resolveUnitPrice', () => {
  it('calls the resolve_unit_price RPC with all four args', async () => {
    const supabase = mockSupabase({ data: 4.25, error: null })
    const result = await resolveUnitPrice(supabase, 'cust-1', 'prod-1', 500, '2026-07-20')
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_unit_price', {
      p_customer_id: 'cust-1',
      p_product_id: 'prod-1',
      p_qty: 500,
      p_as_of: '2026-07-20',
    })
    expect(result).toBe(4.25)
  })

  it('returns null when no tier matches (RPC returns null, not an error)', async () => {
    const supabase = mockSupabase({ data: null, error: null })
    const result = await resolveUnitPrice(supabase, 'cust-1', 'prod-1', 1)
    expect(result).toBeNull()
  })
})

describe('getLatestCostInput', () => {
  it('calls the latest_cost_input RPC and returns the row', async () => {
    const row = {
      raw_material_cost: 1,
      packaging_cost: 0.2,
      labor_cost: 0.3,
      freight_cost_per_unit: 0.1,
      effective_date: '2026-06-01',
    }
    const supabase = mockSupabase({ data: row, error: null })
    const result = await getLatestCostInput(supabase, 'prod-1', '2026-07-20')
    expect(supabase.rpc).toHaveBeenCalledWith('latest_cost_input', {
      p_product_id: 'prod-1',
      p_as_of: '2026-07-20',
    })
    expect(result).toEqual(row)
  })
})
