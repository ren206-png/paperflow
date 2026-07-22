'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Product } from '@/types'
import { Button } from '@/components/ui/Button'

export default function ProductsPage() {
  const supabase = createClient()

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('sku_code')
      if (error) throw error
      return data as Product[]
    },
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products (SKUs)</h1>
          <p className="text-sm text-gray-500">
            Finished-good SKUs with the paper-specific variant matrix — ply, GSM, roll length, sheet count, case pack.
          </p>
        </div>
        <Link href="/dashboard/products/new">
          <Button>New SKU</Button>
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Ply</th>
              <th className="px-4 py-3">GSM</th>
              <th className="px-4 py-3">Roll length (ft)</th>
              <th className="px-4 py-3">Sheets</th>
              <th className="px-4 py-3">Case pack</th>
              <th className="px-4 py-3">UOM</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={9}>Loading…</td></tr>
            )}
            {!isLoading && products?.length === 0 && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={9}>No SKUs yet.</td></tr>
            )}
            {products?.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.sku_code}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                <td className="px-4 py-3 text-gray-600">{p.ply ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{p.gsm ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{p.roll_length_ft ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{p.sheet_count ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{p.case_pack_qty ?? '—'}</td>
                <td className="px-4 py-3 capitalize text-gray-600">{p.unit_of_measure}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/products/${p.id}`} className="font-medium text-brand-600 hover:underline">
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
