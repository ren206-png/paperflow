'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Customer, PriceBook } from '@/types'
import { Button } from '@/components/ui/Button'

export default function PriceBooksPage() {
  const supabase = createClient()

  const { data: priceBooks, isLoading } = useQuery({
    queryKey: ['price-books'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_books')
        .select('*')
        .order('effective_start', { ascending: false })
      if (error) throw error
      return data as PriceBook[]
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

  const customerName = (id: string | null) =>
    id ? customers?.find((c) => c.id === id)?.name ?? '—' : 'Org-wide default'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Books</h1>
          <p className="text-sm text-gray-500">
            Contract and volume pricing with effective dates — the core of PaperFlow.
          </p>
        </div>
        <Link href="/dashboard/price-books/new">
          <Button>New price book</Button>
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Effective</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>Loading…</td></tr>}
            {!isLoading && priceBooks?.length === 0 && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>No price books yet.</td></tr>
            )}
            {priceBooks?.map((pb) => (
              <tr key={pb.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{pb.name}</td>
                <td className="px-4 py-3 text-gray-600">{customerName(pb.customer_id)}</td>
                <td className="px-4 py-3 text-gray-600">{pb.is_contract ? 'Contract' : 'Volume/list'}</td>
                <td className="px-4 py-3 text-gray-600">
                  {pb.effective_start} → {pb.effective_end ?? 'open'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/price-books/${pb.id}`} className="font-medium text-brand-600 hover:underline">
                    Manage
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
