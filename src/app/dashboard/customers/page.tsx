'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Customer } from '@/types'
import { Button } from '@/components/ui/Button'

export default function CustomersPage() {
  const supabase = createClient()

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('name')
      if (error) throw error
      return data as Customer[]
    },
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">Distributors, institutions, and wholesalers you sell to.</p>
        </div>
        <Link href="/dashboard/customers/new">
          <Button>New customer</Button>
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Credit terms</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td className="px-4 py-6 text-gray-500" colSpan={5}>Loading…</td>
              </tr>
            )}
            {!isLoading && customers?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-gray-500" colSpan={5}>
                  No customers yet. Add your first one to start building price books and quotes.
                </td>
              </tr>
            )}
            {customers?.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 capitalize text-gray-600">{c.customer_type}</td>
                <td className="px-4 py-3 text-gray-600">{c.contact_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{c.credit_terms ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/customers/${c.id}`} className="font-medium text-brand-600 hover:underline">
                    Edit
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
