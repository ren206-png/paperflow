'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Customer, Invoice, InvoiceLine, Order, OrderLine, Product } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatCurrency, cn, isUUID } from '@/lib/utils'
import { toast } from 'sonner'

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700',
  fulfilling: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  const [editedQty, setEditedQty] = useState<Record<string, string>>({})
  const isValidId = isUUID(params.id)

  const { data: order } = useQuery({
    queryKey: ['orders', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Order
    },
  })

  const { data: lines } = useQuery({
    queryKey: ['order-lines', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_lines')
        .select('*')
        .eq('order_id', params.id)
        .order('created_at')
      if (error) throw error
      return data as OrderLine[]
    },
  })

  const { data: customer } = useQuery({
    queryKey: ['customers', order?.customer_id],
    enabled: !!order?.customer_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').eq('id', order!.customer_id).single()
      if (error) throw error
      return data as Customer
    },
  })

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*')
      if (error) throw error
      return data as Product[]
    },
  })

  const { data: invoices } = useQuery({
    queryKey: ['invoices', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*').eq('order_id', params.id).order('created_at')
      if (error) throw error
      return data as Invoice[]
    },
  })

  const { data: invoiceLines } = useQuery({
    queryKey: ['invoice-lines', params.id],
    enabled: !!invoices,
    queryFn: async () => {
      const ids = (invoices ?? []).map((i) => i.id)
      if (ids.length === 0) return [] as InvoiceLine[]
      const { data, error } = await supabase.from('invoice_lines').select('*').in('invoice_id', ids)
      if (error) throw error
      return data as InvoiceLine[]
    },
  })

  const { data: qboStatus } = useQuery({
    queryKey: ['quickbooks-status'],
    queryFn: async () => {
      const res = await fetch('/api/quickbooks/status')
      if (!res.ok) return { connected: false, realmId: null }
      return res.json() as Promise<{ connected: boolean; realmId: string | null }>
    },
  })

  const { data: xeroStatus } = useQuery({
    queryKey: ['xero-status'],
    queryFn: async () => {
      const res = await fetch('/api/xero/status')
      if (!res.ok) return { connected: false, tenantId: null }
      return res.json() as Promise<{ connected: boolean; tenantId: string | null }>
    },
  })

  const syncToQuickbooks = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/invoices/${invoiceId}/quickbooks-sync`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to sync to QuickBooks.')
      return body
    },
    onSuccess: () => {
      toast.success('Synced to QuickBooks')
      queryClient.invalidateQueries({ queryKey: ['invoices', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const syncToXero = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/invoices/${invoiceId}/xero-sync`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to sync to Xero.')
      return body
    },
    onSuccess: () => {
      toast.success('Synced to Xero')
      queryClient.invalidateQueries({ queryKey: ['invoices', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const skuFor = (id: string) => products?.find((p) => p.id === id)?.sku_code ?? id

  const invoicedQtyFor = (orderLineId: string) =>
    (invoiceLines ?? [])
      .filter((il) => il.order_line_id === orderLineId)
      .reduce((sum, il) => sum + il.qty_invoiced, 0)

  const updateFulfillment = useMutation({
    mutationFn: async ({ lineId, qty }: { lineId: string; qty: number }) => {
      const { error } = await supabase.from('order_lines').update({ fulfilled_qty: qty }).eq('id', lineId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Fulfillment updated')
      queryClient.invalidateQueries({ queryKey: ['order-lines', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const setStatus = useMutation({
    mutationFn: async (status: Order['status']) => {
      const { error } = await supabase.from('orders').update({ status }).eq('id', params.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!lines) throw new Error('No order lines.')
      const toInvoice = lines
        .map((l) => ({ line: l, remaining: l.fulfilled_qty - invoicedQtyFor(l.id) }))
        .filter((x) => x.remaining > 0)

      if (toInvoice.length === 0) throw new Error('Nothing fulfilled and unbilled yet — update fulfillment first.')

      const totalAmount = toInvoice.reduce((sum, x) => sum + x.remaining * x.line.unit_price, 0)

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          organization_id: organization?.id,
          order_id: params.id,
          status: 'draft',
          total_amount: totalAmount,
        })
        .select()
        .single()
      if (invoiceError) throw invoiceError

      const { error: linesError } = await supabase.from('invoice_lines').insert(
        toInvoice.map((x) => ({
          invoice_id: invoice.id,
          order_line_id: x.line.id,
          qty_invoiced: x.remaining,
          unit_price: x.line.unit_price,
        }))
      )
      if (linesError) throw linesError

      return invoice
    },
    onSuccess: (invoice) => {
      toast.success('Draft invoice created')
      queryClient.invalidateQueries({ queryKey: ['invoices', params.id] })
      queryClient.invalidateQueries({ queryKey: ['invoice-lines', params.id] })
      // Push to whichever accounting provider is connected immediately —
      // the "sync on creation" flow. Failure here isn't fatal to invoice
      // creation itself; the invoice still exists and can be retried with
      // the manual "Sync" button below. Only one provider is ever
      // connected at a time.
      if (qboStatus?.connected) {
        syncToQuickbooks.mutate(invoice.id)
      } else if (xeroStatus?.connected) {
        syncToXero.mutate(invoice.id)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!isValidId) return <p className="text-gray-500">Order not found.</p>
  if (!order) return <p className="text-gray-500">Loading…</p>

  const allFulfilled = (lines ?? []).length > 0 && lines!.every((l) => l.fulfilled_qty >= l.qty)
  const anyUnbilled = (lines ?? []).some((l) => l.fulfilled_qty - invoicedQtyFor(l.id) > 0)

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Order for {customer?.name ?? '—'}</h1>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', STATUS_STYLES[order.status])}>
              {order.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Created {new Date(order.created_at).toLocaleDateString()}</p>
        </div>
        <Link href="/dashboard/orders" className="text-sm font-medium text-brand-600 hover:underline">
          ← Back to orders
        </Link>
      </div>

      <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Qty ordered</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Fulfilled</th>
              <th className="px-4 py-3">Invoiced</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines?.map((l) => {
              const invoiced = invoicedQtyFor(l.id)
              const draftValue = editedQty[l.id] ?? String(l.fulfilled_qty)
              return (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.product_id)}</td>
                  <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_price)}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      max={l.qty}
                      value={draftValue}
                      onChange={(e) => setEditedQty((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{invoiced}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() =>
                        updateFulfillment.mutate({
                          lineId: l.id,
                          qty: Math.max(0, Math.min(l.qty, Number(draftValue) || 0)),
                        })
                      }
                      className="font-medium text-brand-600 hover:underline"
                      disabled={updateFulfillment.isPending}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        {order.status === 'open' && (
          <Button variant="secondary" onClick={() => setStatus.mutate('fulfilling')} disabled={setStatus.isPending}>
            Mark fulfilling
          </Button>
        )}
        {order.status !== 'fulfilled' && order.status !== 'invoiced' && order.status !== 'cancelled' && allFulfilled && (
          <Button variant="secondary" onClick={() => setStatus.mutate('fulfilled')} disabled={setStatus.isPending}>
            Mark fulfilled
          </Button>
        )}
        <Button onClick={() => createInvoice.mutate()} disabled={createInvoice.isPending || !anyUnbilled}>
          {createInvoice.isPending ? 'Creating…' : 'Create draft invoice for fulfilled qty'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-semibold text-gray-900">Invoices</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Accounting</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!invoices?.length && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>No invoices yet.</td></tr>
            )}
            {invoices?.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3 capitalize text-gray-700">{i.status}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(i.total_amount)}</td>
                <td className="px-4 py-3 text-gray-600">{new Date(i.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-gray-500">
                  {i.external_ref ? (
                    `Synced (${i.external_ref})`
                  ) : qboStatus?.connected ? (
                    <button
                      onClick={() => syncToQuickbooks.mutate(i.id)}
                      disabled={syncToQuickbooks.isPending}
                      className="font-medium text-brand-600 hover:underline disabled:opacity-50"
                    >
                      {syncToQuickbooks.isPending ? 'Syncing…' : 'Sync to QuickBooks'}
                    </button>
                  ) : xeroStatus?.connected ? (
                    <button
                      onClick={() => syncToXero.mutate(i.id)}
                      disabled={syncToXero.isPending}
                      className="font-medium text-brand-600 hover:underline disabled:opacity-50"
                    >
                      {syncToXero.isPending ? 'Syncing…' : 'Sync to Xero'}
                    </button>
                  ) : (
                    '— (not connected)'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
