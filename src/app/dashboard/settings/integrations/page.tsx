'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/Button'
import { toast } from 'sonner'

export default function IntegrationsSettingsPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Loading…</p>}>
      <IntegrationsSettingsContent />
    </Suspense>
  )
}

function IntegrationsSettingsContent() {
  const { isOrgAdmin, isLoading } = useAuth()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const { data: qboStatus, isLoading: qboStatusLoading } = useQuery({
    queryKey: ['quickbooks-status'],
    queryFn: async () => {
      const res = await fetch('/api/quickbooks/status')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load QuickBooks status.')
      return body as { connected: boolean; realmId: string | null }
    },
  })

  const { data: xeroStatus, isLoading: xeroStatusLoading } = useQuery({
    queryKey: ['xero-status'],
    queryFn: async () => {
      const res = await fetch('/api/xero/status')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load Xero status.')
      return body as { connected: boolean; tenantId: string | null }
    },
  })

  useEffect(() => {
    const qb = searchParams.get('quickbooks')
    if (qb === 'connected') {
      toast.success('QuickBooks connected.')
      queryClient.invalidateQueries({ queryKey: ['quickbooks-status'] })
    } else if (qb === 'error') {
      toast.error(`QuickBooks connection failed: ${searchParams.get('reason') ?? 'unknown error'}`)
    }
    const xero = searchParams.get('xero')
    if (xero === 'connected') {
      toast.success('Xero connected.')
      queryClient.invalidateQueries({ queryKey: ['xero-status'] })
    } else if (xero === 'error') {
      toast.error(`Xero connection failed: ${searchParams.get('reason') ?? 'unknown error'}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const disconnectQuickbooks = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/quickbooks/disconnect', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not disconnect QuickBooks.')
      return body
    },
    onSuccess: () => {
      toast.success('QuickBooks disconnected.')
      queryClient.invalidateQueries({ queryKey: ['quickbooks-status'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const disconnectXero = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/xero/disconnect', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not disconnect Xero.')
      return body
    },
    onSuccess: () => {
      toast.success('Xero disconnected.')
      queryClient.invalidateQueries({ queryKey: ['xero-status'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) return <p className="text-gray-500">Loading…</p>

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
      <p className="mt-1 text-sm text-gray-500">
        Connect accounting tools PlyCount can push invoices to once an order is fulfilled and invoiced.
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-gray-900">QuickBooks Online</p>
            <p className="mt-1 text-sm text-gray-500">
              {qboStatusLoading
                ? 'Checking connection…'
                : qboStatus?.connected
                  ? `Connected (company ${qboStatus.realmId})`
                  : xeroStatus?.connected
                    ? 'Not connected — disconnect Xero first to connect QuickBooks instead.'
                    : 'Not connected — invoices stay in PlyCount only until you connect.'}
            </p>
          </div>
          {qboStatus?.connected ? (
            <Button
              variant="secondary"
              onClick={() => disconnectQuickbooks.mutate()}
              disabled={!isOrgAdmin || disconnectQuickbooks.isPending}
            >
              {disconnectQuickbooks.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          ) : (
            <a href="/api/quickbooks/connect">
              <Button disabled={!isOrgAdmin || !!xeroStatus?.connected}>Connect QuickBooks</Button>
            </a>
          )}
        </div>
        {!isOrgAdmin && (
          <p className="mt-3 text-sm text-amber-600">
            Only an organization owner or administrator can connect or disconnect QuickBooks.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-gray-900">Xero</p>
            <p className="mt-1 text-sm text-gray-500">
              {xeroStatusLoading
                ? 'Checking connection…'
                : xeroStatus?.connected
                  ? `Connected (tenant ${xeroStatus.tenantId})`
                  : qboStatus?.connected
                    ? 'Not connected — disconnect QuickBooks first to connect Xero instead.'
                    : 'Not connected — invoices stay in PlyCount only until you connect.'}
            </p>
          </div>
          {xeroStatus?.connected ? (
            <Button
              variant="secondary"
              onClick={() => disconnectXero.mutate()}
              disabled={!isOrgAdmin || disconnectXero.isPending}
            >
              {disconnectXero.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          ) : (
            <a href="/api/xero/connect">
              <Button disabled={!isOrgAdmin || !!qboStatus?.connected}>Connect Xero</Button>
            </a>
          )}
        </div>
        {!isOrgAdmin && (
          <p className="mt-3 text-sm text-amber-600">
            Only an organization owner or administrator can connect or disconnect Xero.
          </p>
        )}
      </div>

      <p className="mt-6 text-sm text-gray-400">
        Only one accounting provider can be connected at a time. Once connected, use the
        &ldquo;Sync&rdquo; button on an order&apos;s invoice to push it over — new invoices are synced
        automatically at creation time when a connection is active.
      </p>
    </div>
  )
}
