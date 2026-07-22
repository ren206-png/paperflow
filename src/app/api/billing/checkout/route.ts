// ============================================================
// POST /api/billing/checkout — starts a Stripe Checkout session
// to subscribe the caller's organization to the Starter or Growth
// tier. Reuses `stripe_customer_id` if one already exists.
//
// Uses the cookie-scoped server client, so this relies on the
// existing `organizations_update` RLS policy (is_org_admin()) to
// make sure only an org admin/owner can kick off a plan change —
// no separate authorization check needed here.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, priceIdForTier, type BillingTier } from '@/lib/stripe/server'

export const runtime = 'nodejs'

function isBillingTier(value: unknown): value is BillingTier {
  return value === 'starter' || value === 'growth'
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: 'Billing is not configured yet (STRIPE_SECRET_KEY missing).' },
      { status: 501 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const tier = body?.tier
  if (!isBillingTier(tier)) {
    return NextResponse.json({ error: 'tier must be "starter" or "growth".' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'No organization found for this user.' }, { status: 404 })
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, stripe_customer_id')
    .eq('id', profile.organization_id)
    .single()

  if (orgError || !org) {
    return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
  }

  let priceId: string
  try {
    priceId = priceIdForTier(tier)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 501 })
  }

  const stripe = getStripe()
  const origin = req.headers.get('origin') ?? new URL(req.url).origin

  let customerId = org.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      email: user.email ?? undefined,
      metadata: { organization_id: org.id },
    })
    customerId = customer.id

    // Persist immediately so a retry doesn't create duplicate Stripe customers.
    // Gated by the organizations_update RLS policy (org admins only).
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ stripe_customer_id: customerId })
      .eq('id', org.id)

    if (updateError) {
      return NextResponse.json(
        { error: `Could not save Stripe customer: ${updateError.message}` },
        { status: 403 }
      )
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/settings/billing?checkout=success`,
    cancel_url: `${origin}/dashboard/settings/billing?checkout=canceled`,
    client_reference_id: org.id,
    subscription_data: {
      metadata: { organization_id: org.id },
    },
  })

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout URL.' }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
