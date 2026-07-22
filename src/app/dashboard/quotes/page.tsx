'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Customer, Quote } from '@/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  expired: 'bg-red-100 text-red-700',
}

export default function QuotesPage() {
  const supabase = createClient()

  const { data: quotes, isLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('quotes').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Quote[]
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
          <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
          <p className="text-sm text-gray-500">Live margin per line, priced against contract/volume books.</p>
        </div>
        <Link href="/dashboard/quotes/new">
          <Button>New quote</Button>
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>Loading…</td></tr>}
            {!isLoading && quotes?.length === 0 && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>No quotes yet.</td></tr>
            )}
            {quotes?.map((q) => (
              <tr key={q.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{customerName(q.customer_id)}</td>
                <td className="px-4 py-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', STATUS_STYLES[q.status])}>
                    {q.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{new Date(q.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-gray-600">{q.expires_at ? new Date(q.expires_at).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/quotes/${q.id}`} className="font-medium text-brand-600 hover:underline">
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
