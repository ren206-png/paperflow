// ============================================================
// Domain types — hand-rolled rather than generated from
// `supabase gen types`. Fine at MVP scale; keep in sync with
// the migrations under /supabase/migrations by hand for now.
// ============================================================

export type UserRole =
  | 'platform_admin'
  | 'organization_owner'
  | 'administrator'
  | 'sales_rep'
  | 'client_viewer'

export type SubscriptionTier = 'free_trial' | 'starter' | 'growth'
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused'

export interface Organization {
  id: string
  name: string
  slug: string
  subscription_tier: SubscriptionTier
  subscription_status: SubscriptionStatus
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  auth_user_id: string
  organization_id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url: string | null
  phone: string | null
  // Set only for `client_viewer` rows — scopes a portal login to the one
  // customer it may see. Null for staff.
  customer_id: string | null
  status: 'active' | 'invited' | 'suspended' | 'deactivated'
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export type CustomerType = 'distributor' | 'institution' | 'wholesaler' | 'other'

export interface Customer {
  id: string
  organization_id: string
  name: string
  customer_type: CustomerType
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  credit_terms: string | null
  notes: string | null
  default_price_book_id: string | null
  quickbooks_customer_id: string | null
  xero_contact_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type UnitOfMeasure = 'each' | 'roll' | 'case' | 'pallet'

export interface Product {
  id: string
  organization_id: string
  name: string
  sku_code: string
  ply: number | null
  gsm: number | null
  roll_length_ft: number | null
  sheet_count: number | null
  case_pack_qty: number | null
  unit_of_measure: UnitOfMeasure
  quickbooks_item_id: string | null
  xero_item_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CostInput {
  id: string
  organization_id: string
  product_id: string
  raw_material_cost: number
  packaging_cost: number
  labor_cost: number
  freight_cost_per_unit: number
  effective_date: string
  source: 'manual' | 'import'
  created_by: string | null
  created_at: string
}

export interface PriceBook {
  id: string
  organization_id: string
  customer_id: string | null // null = org-wide default/list book
  name: string
  is_contract: boolean
  effective_start: string
  effective_end: string | null
  created_at: string
  updated_at: string
}

export interface PriceBookLine {
  id: string
  price_book_id: string
  product_id: string
  unit_price: number
  min_qty: number
  max_qty: number | null
  created_at: string
  updated_at: string
}

// Computed (never stored) — see supabase/migrations/20260704007_margin_guard.sql.
// margin_pct/current_unit_cost/cost_effective_date are null when the SKU has
// no cost_inputs row yet at all.
export interface PriceBookLineMargin {
  price_book_line_id: string
  price_book_id: string
  product_id: string
  unit_price: number
  min_qty: number
  max_qty: number | null
  price_updated_at: string
  organization_id: string
  customer_id: string | null
  price_book_name: string
  is_contract: boolean
  current_unit_cost: number | null
  cost_effective_date: string | null
  margin_pct: number | null
}

export type MarginAlertAction = 'dismissed' | 'repriced'

export interface MarginAlertReview {
  id: string
  organization_id: string
  price_book_line_id: string
  reviewed_cost_effective_date: string
  action: MarginAlertAction
  previous_unit_price: number | null
  new_unit_price: number | null
  reviewed_by: string | null
  created_at: string
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'expired'

export interface Quote {
  id: string
  organization_id: string
  customer_id: string
  price_book_id: string | null
  status: QuoteStatus
  created_by: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface QuoteLine {
  id: string
  quote_id: string
  product_id: string
  qty: number
  unit_price: number
  unit_cost_snapshot: number
  cost_effective_date: string | null
  margin_pct: number
  created_at: string
}

export type OrderStatus = 'open' | 'fulfilling' | 'fulfilled' | 'invoiced' | 'cancelled'

export interface Order {
  id: string
  organization_id: string
  quote_id: string | null
  customer_id: string
  status: OrderStatus
  created_at: string
  updated_at: string
}

export interface OrderLine {
  id: string
  order_id: string
  product_id: string
  qty: number
  unit_price: number
  unit_cost_snapshot: number
  fulfilled_qty: number
  created_at: string
  updated_at: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export interface Invoice {
  id: string
  organization_id: string
  order_id: string
  status: InvoiceStatus
  external_ref: string | null
  total_amount: number
  created_at: string
  updated_at: string
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  order_line_id: string
  qty_invoiced: number
  unit_price: number
  created_at: string
}
