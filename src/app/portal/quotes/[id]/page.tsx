'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Product, Quote } from '@/types'
import { formatCurrency, isUUID } from '@/lib/utils'

type PortalQuoteLine = { id: string; product_id: string; qty: number; unit_price: number }

export default function PortalQuoteDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const isValidId = isUUID(params.id)

  const { data: quote } = useQuery({
    queryKey: ['portal-quotes', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('quotes').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Quote
    },
  })

  const { data: lines } = useQuery({
    queryKey: ['portal-quote-lines', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_lines')
        .select('id, product_id, qty, unit_price')
        .eq('quote_id', params.id)
        .order('created_at')
      if (error) throw error
      return data as PortalQuoteLine[]
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
  const total = (lines ?? []).reduce((sum, l) => sum + l.qty * l.unit_price, 0)

  if (!isValidId) return <p className="text-gray-500">Quote not found.</p>
  if (!quote) return <p className="text-gray-500">Loading…</p>

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Quote</h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold capitalize text-gray-700">
              {quote.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Created {new Date(quote.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`/api/quotes/${quote.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Download PDF
          </a>
          <Link href="/portal/quotes" className="text-sm font-medium text-brand-600 hover:underline">
            ← Back to quotes
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines?.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.product_id)}</td>
                <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_price)}</td>
                <td className="px-4 py-3 text-gray-900">{formatCurrency(l.qty * l.unit_price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200">
              <td className="px-4 py-3 text-right font-semibold text-gray-900" colSpan={3}>Total</td>
              <td className="px-4 py-3 font-semibold text-gray-900">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
