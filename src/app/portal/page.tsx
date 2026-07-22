'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'

export default function PortalHomePage() {
  const supabase = createClient()
  const { profile } = useAuth()

  const { data: openQuotes } = useQuery({
    queryKey: ['portal-summary-quotes'],
    enabled: !!profile,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
      if (error) throw error
      return count ?? 0
    },
  })

  const { data: openOrders } = useQuery({
    queryKey: ['portal-summary-orders'],
    enabled: !!profile,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'fulfilling', 'fulfilled'])
      if (error) throw error
      return count ?? 0
    },
  })

  const { data: unpaidInvoices } = useQuery({
    queryKey: ['portal-summary-invoices'],
    enabled: !!profile,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .in('status', ['sent'])
      if (error) throw error
      return count ?? 0
    },
  })

  const cards = [
    { href: '/portal/quotes', label: 'Open quotes', value: openQuotes },
    { href: '/portal/orders', label: 'Open orders', value: openOrders },
    { href: '/portal/invoices', label: 'Unpaid invoices', value: unpaidInvoices },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Welcome{profile ? `, ${profile.full_name}` : ''}</h1>
      <p className="mt-1 text-sm text-gray-500">A read-only view of your quotes, orders, and invoices.</p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-gray-200 bg-white p-5 hover:border-brand-300"
          >
            <p className="text-3xl font-bold text-gray-900">{c.value ?? '—'}</p>
            <p className="mt-1 text-sm text-gray-500">{c.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
