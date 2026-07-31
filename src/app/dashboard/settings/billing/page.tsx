'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const TIER_COPY: Record<string, { label: string; blurb: string }> = {
  free_trial: { label: 'Free Trial', blurb: 'Full access while you evaluate PlyCount.' },
  starter: { label: 'Starter', blurb: 'For a single location getting started with contract pricing.' },
  growth: { label: 'Growth', blurb: 'For multi-rep teams that need price books and margin visibility at scale.' },
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-amber-100 text-amber-700',
  canceled: 'bg-red-100 text-red-700',
  paused: 'bg-gray-100 text-gray-700',
}

async function postJson(url: string) {
  const res = await fetch(url, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Something went wrong.')
  return body as { url?: string }
}

export default function BillingSettingsPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Loading…</p>}>
      <BillingSettingsContent />
    </Suspense>
  )
}

function BillingSettingsContent() {
  const { organization, isOrgAdmin, isLoading, refreshProfile } = useAuth()
  const searchParams = useSearchParams()

  useEffect(() => {
    const checkout = searchParams.get('checkout')
    if (checkout === 'success') {
      toast.success('Subscription updated — refreshing your plan…')
      refreshProfile()
    } else if (checkout === 'canceled') {
      toast('Checkout canceled — no changes were made.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const checkoutMutation = useMutation({
    mutationFn: async (tier: 'starter' | 'growth') => {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not start checkout.')
      return body as { url: string }
    },
    onSuccess: (body) => {
      window.location.href = body.url
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const portalMutation = useMutation({
    mutationFn: () => postJson('/api/billing/portal'),
    onSuccess: (body) => {
      if (body.url) window.location.href = body.url
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) return <p className="text-gray-500">Loading…</p>
  if (!organization) return <p className="text-gray-500">No organization found.</p>

  const currentTier = organization.subscription_tier
  const currentStatus = organization.subscription_status

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
      <p className="mt-1 text-sm text-gray-500">
        Manage your PlyCount subscription. This is separate from your customers&apos; invoices, which stay in
        Orders / QuickBooks.
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Current plan</p>
            <p className="text-lg font-semibold text-gray-900">{TIER_COPY[currentTier]?.label ?? currentTier}</p>
          </div>
          <span className={cn('rounded-full px-3 py-1 text-xs font-semibold capitalize', STATUS_STYLES[currentStatus])}>
            {currentStatus.replace('_', ' ')}
          </span>
        </div>
        {organization.stripe_customer_id && (
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
          >
            {portalMutation.isPending ? 'Opening…' : 'Manage billing'}
          </Button>
        )}
      </div>

      {!isOrgAdmin && (
        <p className="mt-4 text-sm text-amber-600">
          Only an organization owner or administrator can change the subscription plan.
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(['starter', 'growth'] as const).map((tier) => (
          <div key={tier} className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-lg font-semibold text-gray-900">{TIER_COPY[tier].label}</p>
            <p className="mt-1 text-sm text-gray-500">{TIER_COPY[tier].blurb}</p>
            <Button
              className="mt-4 w-full"
              disabled={!isOrgAdmin || currentTier === tier || checkoutMutation.isPending}
              onClick={() => checkoutMutation.mutate(tier)}
            >
              {currentTier === tier
                ? 'Current plan'
                : checkoutMutation.isPending
                  ? 'Redirecting…'
                  : `Upgrade to ${TIER_COPY[tier].label}`}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
