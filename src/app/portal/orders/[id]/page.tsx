'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Order, Product } from '@/types'
import { cn, formatCurrency, isUUID } from '@/lib/utils'

type PortalOrderLine = { id: string; product_id: string; qty: number; unit_price: number; fulfilled_qty: number }

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700',
  fulfilling: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function PortalOrderDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const isValidId = isUUID(params.id)

  const { data: order } = useQuery({
    queryKey: ['portal-orders', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Order
    },
  })

  const { data: lines } = useQuery({
    queryKey: ['portal-order-lines', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_lines')
        .select('id, product_id, qty, unit_price, fulfilled_qty')
        .eq('order_id', params.id)
        .order('created_at')
      if (error) throw error
      return data as PortalOrderLine[]
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

  if (!isValidId) return <p className="text-gray-500">Order not found.</p>
  if (!order) return <p className="text-gray-500">Loading…</p>

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Order</h1>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', STATUS_STYLES[order.status])}>
              {order.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Created {new Date(order.created_at).toLocaleDateString()}</p>
        </div>
        <Link href="/portal/orders" className="text-sm font-medium text-brand-600 hover:underline">
          ← Back to orders
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Qty ordered</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Fulfilled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines?.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.product_id)}</td>
                <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_price)}</td>
                <td className="px-4 py-3 text-gray-600">{l.fulfilled_qty} / {l.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
