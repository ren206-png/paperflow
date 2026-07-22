'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Invoice, InvoiceLine, Product } from '@/types'
import { formatCurrency, isUUID } from '@/lib/utils'

type PortalOrderLineRef = { id: string; product_id: string }

export default function PortalInvoiceDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const isValidId = isUUID(params.id)

  const { data: invoice } = useQuery({
    queryKey: ['portal-invoices', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Invoice
    },
  })

  const { data: lines } = useQuery({
    queryKey: ['portal-invoice-lines', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('invoice_lines').select('*').eq('invoice_id', params.id)
      if (error) throw error
      return data as InvoiceLine[]
    },
  })

  const { data: orderLines } = useQuery({
    queryKey: ['portal-order-line-refs', params.id],
    enabled: !!lines,
    queryFn: async () => {
      const ids = Array.from(new Set((lines ?? []).map((l) => l.order_line_id)))
      if (ids.length === 0) return [] as PortalOrderLineRef[]
      const { data, error } = await supabase.from('order_lines').select('id, product_id').in('id', ids)
      if (error) throw error
      return data as PortalOrderLineRef[]
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

  const skuFor = (orderLineId: string) => {
    const productId = orderLines?.find((ol) => ol.id === orderLineId)?.product_id
    return products?.find((p) => p.id === productId)?.sku_code ?? '—'
  }

  if (!isValidId) return <p className="text-gray-500">Invoice not found.</p>
  if (!invoice) return <p className="text-gray-500">Loading…</p>

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Invoice</h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold capitalize text-gray-700">
              {invoice.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Created {new Date(invoice.created_at).toLocaleDateString()}</p>
        </div>
        <Link href="/portal/invoices" className="text-sm font-medium text-brand-600 hover:underline">
          ← Back to invoices
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Qty invoiced</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines?.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.order_line_id)}</td>
                <td className="px-4 py-3 text-gray-600">{l.qty_invoiced}</td>
                <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_price)}</td>
                <td className="px-4 py-3 text-gray-900">{formatCurrency(l.qty_invoiced * l.unit_price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200">
              <td className="px-4 py-3 text-right font-semibold text-gray-900" colSpan={3}>Total</td>
              <td className="px-4 py-3 font-semibold text-gray-900">{formatCurrency(invoice.total_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
