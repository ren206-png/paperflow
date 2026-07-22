'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Invoice } from '@/types'
import { formatCurrency } from '@/lib/utils'

export default function PortalInvoicesPage() {
  const supabase = createClient()

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Invoice[]
    },
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>Loading…</td></tr>}
            {!isLoading && !invoices?.length && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={4}>No invoices yet.</td></tr>
            )}
            {invoices?.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 capitalize text-gray-700">{i.status}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(i.total_amount)}</td>
                <td className="px-4 py-3 text-gray-600">{new Date(i.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/portal/invoices/${i.id}`} className="font-medium text-brand-600 hover:underline">
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
