// ============================================================
// Stripe server client — platform subscription billing only
// (Starter/Growth tiers). This is separate from customer AR;
// invoices to PlyCount's own customers stay in `invoices` /
// QuickBooks sync (see src/lib/quickbooks), not Stripe.
// SERVER-ONLY: never import from a Client Component.
// ============================================================
import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.')
  }
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-07-29.dahlia',
    })
  }
  return _stripe
}

export type BillingTier = 'starter' | 'growth'

export function priceIdForTier(tier: BillingTier): string {
  const priceId = tier === 'starter' ? process.env.STRIPE_PRICE_STARTER : process.env.STRIPE_PRICE_GROWTH
  if (!priceId) {
    throw new Error(`No Stripe price configured for the "${tier}" tier (check STRIPE_PRICE_${tier.toUpperCase()}).`)
  }
  return priceId
}

export function tierForPriceId(priceId: string): BillingTier | null {
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter'
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return 'growth'
  return null
}
