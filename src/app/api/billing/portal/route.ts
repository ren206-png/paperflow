// ============================================================
// POST /api/billing/portal — creates a Stripe Billing Portal
// session so an org admin can update payment method, view
// invoices, or cancel the subscription. Requires an existing
// stripe_customer_id (i.e. checkout must have happened already).
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: 'Billing is not configured yet (STRIPE_SECRET_KEY missing).' },
      { status: 501 }
    )
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
    .select('id, stripe_customer_id')
    .eq('id', profile.organization_id)
    .single()

  if (orgError || !org) {
    return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
  }

  if (!org.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No billing account yet — subscribe to a plan first.' },
      { status: 400 }
    )
  }

  const stripe = getStripe()
  const origin = req.headers.get('origin') ?? new URL(req.url).origin

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${origin}/dashboard/settings/billing`,
  })

  return NextResponse.json({ url: session.url })
}
