'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Customer, Product, PriceBook, Quote, QuoteLine } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatPercent, cn, isUUID } from '@/lib/utils'
import { marginPct } from '@/lib/pricing/resolve'
import { toast } from 'sonner'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  expired: 'bg-red-100 text-red-700',
}

export default function QuoteDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { organization } = useAuth()
  const isValidId = isUUID(params.id)

  const { data: quote } = useQuery({
    queryKey: ['quotes', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('quotes').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Quote
    },
  })

  const { data: lines } = useQuery({
    queryKey: ['quote-lines', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_lines')
        .select('*')
        .eq('quote_id', params.id)
        .order('created_at')
      if (error) throw error
      return data as QuoteLine[]
    },
  })

  const { data: customer } = useQuery({
    queryKey: ['customers', quote?.customer_id],
    enabled: !!quote?.customer_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').eq('id', quote!.customer_id).single()
      if (error) throw error
      return data as Customer
    },
  })

  const { data: priceBook } = useQuery({
    queryKey: ['price-books', quote?.price_book_id],
    enabled: !!quote?.price_book_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('price_books').select('*').eq('id', quote!.price_book_id!).single()
      if (error) throw error
      return data as PriceBook
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

  const skuFor = (id: string) => products?.find((p) => p.id === id)?.sku_code ?? id

  const quoteTotal = (lines ?? []).reduce((sum, l) => sum + l.qty * l.unit_price, 0)
  const totalCost = (lines ?? []).reduce((sum, l) => sum + l.qty * l.unit_cost_snapshot, 0)
  const blendedMargin = quoteTotal > 0 ? marginPct(quoteTotal, totalCost) : 0

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!quote || !lines || lines.length === 0) throw new Error('Quote has no lines to convert.')

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          organization_id: organization?.id,
          quote_id: quote.id,
          customer_id: quote.customer_id,
          status: 'open',
        })
        .select()
        .single()
      if (orderError) throw orderError

      const { error: orderLinesError } = await supabase.from('order_lines').insert(
        lines.map((l) => ({
          order_id: order.id,
          product_id: l.product_id,
          qty: l.qty,
          unit_price: l.unit_price,
          unit_cost_snapshot: l.unit_cost_snapshot,
        }))
      )
      if (orderLinesError) throw orderLinesError

      const { error: statusError } = await supabase
        .from('quotes')
        .update({ status: 'accepted' })
        .eq('id', quote.id)
      if (statusError) throw statusError

      const { error: auditError } = await supabase.rpc('log_quote_conversion', {
        p_quote_id: quote.id,
        p_order_id: order.id,
      })
      if (auditError) throw auditError

      return order
    },
    onSuccess: (order) => {
      toast.success('Quote converted to order')
      queryClient.invalidateQueries({ queryKey: ['quotes', params.id] })
      router.push(`/dashboard/orders/${order.id}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/quotes/${params.id}/send`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to send quote.')
      return body
    },
    onSuccess: () => {
      toast.success(`Quote emailed to ${customer?.contact_email}`)
      queryClient.invalidateQueries({ queryKey: ['quotes', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!isValidId) return <p className="text-gray-500">Quote not found.</p>
  if (!quote) return <p className="text-gray-500">Loading…</p>

  const canConvert = quote.status === 'draft' || quote.status === 'sent'

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Quote for {customer?.name ?? '—'}</h1>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', STATUS_STYLES[quote.status])}>
              {quote.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {priceBook ? (
              <>Priced from: <span className="font-medium text-gray-800">{priceBook.name}</span></>
            ) : (
              'No price book — manually priced'
            )}
            {' · '}Created {new Date(quote.created_at).toLocaleDateString()}
          </p>
        </div>
        <Link href="/dashboard/quotes" className="text-sm font-medium text-brand-600 hover:underline">
          ← Back to quotes
        </Link>
      </div>

      <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Unit cost</th>
              <th className="px-4 py-3">Line total</th>
              <th className="px-4 py-3">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!lines?.length && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>No lines on this quote.</td></tr>
            )}
            {lines?.map((l) => {
              const margin = marginPct(l.unit_price, l.unit_cost_snapshot)
              return (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.product_id)}</td>
                  <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_price)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_cost_snapshot)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(l.qty * l.unit_price)}</td>
                  <td className={cn('px-4 py-3 font-semibold', margin < 15 ? 'text-red-600' : 'text-green-700')}>
                    {formatPercent(margin)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
            <tr>
              <td className="px-4 py-3" colSpan={4}>Total</td>
              <td className="px-4 py-3">{formatCurrency(quoteTotal)}</td>
              <td className={cn('px-4 py-3', blendedMargin < 15 ? 'text-red-600' : 'text-green-700')}>
                {formatPercent(blendedMargin)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/api/quotes/${params.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
        >
          Download PDF
        </a>
        {(quote.status === 'draft' || quote.status === 'sent') && (
          <Button variant="secondary" onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
            {sendMutation.isPending ? 'Sending…' : quote.status === 'sent' ? 'Resend to customer' : 'Send to customer'}
          </Button>
        )}
        {canConvert && (
          <Button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
            {convertMutation.isPending ? 'Converting…' : 'Convert to order'}
          </Button>
        )}
        {quote.status === 'accepted' && (
          <p className="self-center text-sm text-gray-500">This quote has been converted to an order.</p>
        )}
      </div>
      {customer && !customer.contact_email && (
        <p className="mt-3 text-sm text-amber-600">
          This customer has no contact email — add one on the customer page before sending.
        </p>
      )}
    </div>
  )
}
