// ============================================================
// POST /api/stripe/webhook — Stripe sends subscription lifecycle
// events here. No user session exists for a webhook call, so this
// uses the service-role admin client (bypasses RLS) and instead
// trusts Stripe's signature verification for authenticity.
//
// Handles:
//   checkout.session.completed   -> subscription created, tier set
//   customer.subscription.updated -> tier/status kept in sync
//   customer.subscription.deleted -> falls back to free_trial/canceled
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, tierForPriceId } from '@/lib/stripe/server'

export const runtime = 'nodejs'

function mapStripeStatus(status: Stripe.Subscription.Status): 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused' {
  switch (status) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due'
    case 'paused':
      return 'paused'
    case 'canceled':
    default:
      return 'canceled'
  }
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const admin = createAdminClient()
  const organizationId = subscription.metadata?.organization_id

  const priceId = subscription.items.data[0]?.price?.id
  const tier = priceId ? tierForPriceId(priceId) : null

  const update: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    subscription_status: mapStripeStatus(subscription.status),
  }
  if (tier) update.subscription_tier = tier

  let query = admin.from('organizations').update(update)
  query = organizationId
    ? query.eq('id', organizationId)
    : query.eq('stripe_customer_id', subscription.customer as string)

  const { error } = await query
  if (error) {
    console.error('Failed to sync subscription to organization:', error.message)
    Sentry.captureException(new Error(`Stripe webhook: failed to sync subscription: ${error.message}`))
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const admin = createAdminClient()
  const organizationId = subscription.metadata?.organization_id

  let query = admin.from('organizations').update({
    subscription_tier: 'free_trial',
    subscription_status: 'canceled',
  })
  query = organizationId
    ? query.eq('id', organizationId)
    : query.eq('stripe_customer_id', subscription.customer as string)

  const { error } = await query
  if (error) {
    console.error('Failed to mark subscription canceled:', error.message)
    Sentry.captureException(new Error(`Stripe webhook: failed to mark subscription canceled: ${error.message}`))
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe webhook is not configured.' }, { status: 501 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 })
  }

  const rawBody = await req.text()
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    // Deliberately not captured to Sentry: an invalid signature is the
    // expected shape of a malformed/hostile request, not an app bug —
    // capturing every probe here would just be noise.
    return NextResponse.json({ error: `Invalid signature: ${(err as Error).message}` }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
        await syncSubscription(subscription)
      }
      break
    }
    case 'customer.subscription.updated': {
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
    }
    case 'customer.subscription.deleted': {
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      break
    }
    default:
      // Ignore events we don't act on.
      break
  }

  return NextResponse.json({ received: true })
}
