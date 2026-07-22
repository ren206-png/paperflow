// ============================================================
// Thin wrappers around the Postgres RPCs that do the actual
// pricing/costing resolution (see supabase/migrations/*_price_books.sql
// and *_cost_inputs.sql). Keeping this logic in the database means
// the quote builder and any future integration (portal, EDI) get
// identical pricing behavior for free — no duplicated JS math that
// can drift from the source of truth.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

export async function resolvePriceBookId(
  supabase: SupabaseClient,
  customerId: string,
  asOf: string = new Date().toISOString().slice(0, 10)
): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_price_book', {
    p_customer_id: customerId,
    p_as_of: asOf,
  })
  if (error) throw error
  return data
}

export async function resolveUnitPrice(
  supabase: SupabaseClient,
  customerId: string,
  productId: string,
  qty: number,
  asOf: string = new Date().toISOString().slice(0, 10)
): Promise<number | null> {
  const { data, error } = await supabase.rpc('resolve_unit_price', {
    p_customer_id: customerId,
    p_product_id: productId,
    p_qty: qty,
    p_as_of: asOf,
  })
  if (error) throw error
  return data
}

export interface LatestCostInput {
  raw_material_cost: number
  packaging_cost: number
  labor_cost: number
  freight_cost_per_unit: number
  effective_date: string
}

export async function getLatestCostInput(
  supabase: SupabaseClient,
  productId: string,
  asOf: string = new Date().toISOString().slice(0, 10)
): Promise<LatestCostInput | null> {
  const { data, error } = await supabase.rpc('latest_cost_input', {
    p_product_id: productId,
    p_as_of: asOf,
  })
  if (error) throw error
  return data
}

export function totalUnitCost(ci: LatestCostInput): number {
  return ci.raw_material_cost + ci.packaging_cost + ci.labor_cost + ci.freight_cost_per_unit
}

export function marginPct(unitPrice: number, unitCost: number): number {
  if (unitPrice === 0) return 0
  return Math.round(((unitPrice - unitCost) / unitPrice) * 1000) / 10
}
