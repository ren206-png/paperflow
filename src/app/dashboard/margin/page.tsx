'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Customer, Order, OrderLine, Product } from '@/types'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
import { marginPct } from '@/lib/pricing/resolve'
import { rollUp } from '@/lib/margin/rollup'

export default function MarginDashboardPage() {
  const supabase = createClient()

  // Margin is rolled up from booked orders (order_lines), not open quotes —
  // this is realized/committed margin, not pipeline. Quotes stay visible
  // per-quote on their own detail page.
  const { data: orders } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*')
      if (error) throw error
      return data as Order[]
    },
  })

  const { data: orderLines, isLoading } = useQuery({
    queryKey: ['all-order-lines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('order_lines').select('*')
      if (error) throw error
      return data as OrderLine[]
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

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*')
      if (error) throw error
      return data as Customer[]
    },
  })

  const skuFor = (id: string) => products?.find((p) => p.id === id)?.sku_code ?? id
  const orderFor = (id: string) => orders?.find((o) => o.id === id)
  const customerNameForOrder = (orderId: string) => {
    const order = orderFor(orderId)
    if (!order) return 'Unknown'
    return customers?.find((c) => c.id === order.customer_id)?.name ?? 'Unknown'
  }

  const bySku = useMemo(() => {
    if (!orderLines) return []
    return rollUp(
      orderLines.map((l) => ({
        label: skuFor(l.product_id),
        revenue: l.qty * l.unit_price,
        cost: l.qty * l.unit_cost_snapshot,
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderLines, products])

  const byCustomer = useMemo(() => {
    if (!orderLines) return []
    return rollUp(
      orderLines.map((l) => ({
        label: customerNameForOrder(l.order_id),
        revenue: l.qty * l.unit_price,
        cost: l.qty * l.unit_cost_snapshot,
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderLines, orders, customers])

  const totalRevenue = (orderLines ?? []).reduce((sum, l) => sum + l.qty * l.unit_price, 0)
  const totalCost = (orderLines ?? []).reduce((sum, l) => sum + l.qty * l.unit_cost_snapshot, 0)
  const overallMargin = totalRevenue > 0 ? marginPct(totalRevenue, totalCost) : 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Margin Dashboard</h1>
        <p className="text-sm text-gray-500">
          Realized margin from booked orders (not open quotes), rolled up by SKU and by customer.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Total revenue</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Total cost</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(totalCost)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Blended margin</p>
          <p className={cn('mt-1 text-xl font-bold', overallMargin < 15 ? 'text-red-600' : 'text-green-700')}>
            {formatPercent(overallMargin)}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="font-semibold text-gray-900">Margin by SKU</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={3}>Loading…</td></tr>}
              {!isLoading && bySku.length === 0 && (
                <tr><td className="px-4 py-6 text-gray-500" colSpan={3}>No booked orders yet.</td></tr>
              )}
              {bySku.map((b) => {
                const margin = marginPct(b.revenue, b.cost)
                return (
                  <tr key={b.key}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{b.label}</td>
                    <td className="px-4 py-3 text-gray-600">{formatCurrency(b.revenue)}</td>
                    <td className={cn('px-4 py-3 font-semibold', margin < 15 ? 'text-red-600' : 'text-green-700')}>
                      {formatPercent(margin)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="font-semibold text-gray-900">Margin by customer</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={3}>Loading…</td></tr>}
              {!isLoading && byCustomer.length === 0 && (
                <tr><td className="px-4 py-6 text-gray-500" colSpan={3}>No booked orders yet.</td></tr>
              )}
              {byCustomer.map((b) => {
                const margin = marginPct(b.revenue, b.cost)
                return (
                  <tr key={b.key}>
                    <td className="px-4 py-3 text-gray-700">{b.label}</td>
                    <td className="px-4 py-3 text-gray-600">{formatCurrency(b.revenue)}</td>
                    <td className={cn('px-4 py-3 font-semibold', margin < 15 ? 'text-red-600' : 'text-green-700')}>
                      {formatPercent(margin)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
