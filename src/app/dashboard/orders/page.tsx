'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Customer, Order } from '@/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700',
  fulfilling: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function OrdersPage() {
  const supabase = createClient()

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Order[]
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

  const customerName = (id: string) => customers?.find((c) => c.id === id)?.name ?? '—'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">Orders created from accepted quotes. Track fulfillment through to invoicing.</p>
        </div>
        <Link href="/dashboard/orders/new">
          <Button>New order</Button>
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>Loading…</td></tr>}
            {!isLoading && orders?.length === 0 && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>No orders yet. Convert a quote to create one.</td></tr>
            )}
            {orders?.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{customerName(o.customer_id)}</td>
                <td className="px-4 py-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', STATUS_STYLES[o.status])}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{new Date(o.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/orders/${o.id}`} className="font-medium text-brand-600 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
