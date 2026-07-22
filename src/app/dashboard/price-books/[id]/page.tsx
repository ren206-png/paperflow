'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { PriceBook, PriceBookLine, Product } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { formatCurrency, isUUID } from '@/lib/utils'
import { toast } from 'sonner'

export default function PriceBookDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const isValidId = isUUID(params.id)

  const [productId, setProductId] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [minQty, setMinQty] = useState('1')
  const [maxQty, setMaxQty] = useState('')

  const { data: priceBook } = useQuery({
    queryKey: ['price-books', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('price_books').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as PriceBook
    },
  })

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('sku_code')
      if (error) throw error
      return data as Product[]
    },
  })

  const { data: lines, isLoading } = useQuery({
    queryKey: ['price-book-lines', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_book_lines')
        .select('*')
        .eq('price_book_id', params.id)
        .order('product_id')
        .order('min_qty')
      if (error) throw error
      return data as PriceBookLine[]
    },
  })

  const addLine = useMutation({
    mutationFn: async () => {
      // Guard against an overlapping tier for the same product (edge case
      // #3: boundary quantities must resolve to exactly one price).
      const overlapping = (lines ?? []).some((l) => {
        if (l.product_id !== productId) return false
        const newMin = Number(minQty)
        const newMax = maxQty ? Number(maxQty) : Infinity
        const existingMax = l.max_qty ?? Infinity
        return newMin <= existingMax && l.min_qty <= newMax
      })
      if (overlapping) {
        throw new Error('This quantity range overlaps an existing tier for this SKU. Adjust min/max qty first.')
      }

      const { error } = await supabase.from('price_book_lines').insert({
        price_book_id: params.id,
        product_id: productId,
        unit_price: Number(unitPrice),
        min_qty: Number(minQty || 1),
        max_qty: maxQty ? Number(maxQty) : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-book-lines', params.id] })
      toast.success('Line added')
      setProductId('')
      setUnitPrice('')
      setMinQty('1')
      setMaxQty('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const removeLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await supabase.from('price_book_lines').delete().eq('id', lineId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-book-lines', params.id] })
      toast.success('Line removed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const skuFor = (id: string) => products?.find((p) => p.id === id)?.sku_code ?? id

  if (!isValidId) return <p className="text-gray-500">Price book not found.</p>
  if (!priceBook) return <p className="text-gray-500">Loading…</p>

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{priceBook.name}</h1>
      <p className="mb-6 text-sm text-gray-500">
        {priceBook.is_contract ? 'Contract' : 'Volume/list'} price book · effective {priceBook.effective_start}
        {priceBook.effective_end ? ` → ${priceBook.effective_end}` : ' (open-ended)'}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          addLine.mutate()
        }}
        className="mb-8 grid max-w-3xl grid-cols-5 items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div className="col-span-2">
          <Label>Product</Label>
          <Select required value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select SKU…</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>{p.sku_code} — {p.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Unit price</Label>
          <Input required type="number" step="0.0001" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </div>
        <div>
          <Label>Min qty</Label>
          <Input type="number" min={1} value={minQty} onChange={(e) => setMinQty(e.target.value)} />
        </div>
        <div>
          <Label>Max qty (optional)</Label>
          <Input type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} />
        </div>
        <div className="col-span-5">
          <Button type="submit" disabled={addLine.isPending || !productId}>
            {addLine.isPending ? 'Adding…' : 'Add tier'}
          </Button>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Min qty</th>
              <th className="px-4 py-3">Max qty</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>Loading…</td></tr>}
            {!isLoading && lines?.length === 0 && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={5}>No pricing tiers yet.</td></tr>
            )}
            {lines?.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.product_id)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(l.unit_price)}</td>
                <td className="px-4 py-3 text-gray-600">{l.min_qty}</td>
                <td className="px-4 py-3 text-gray-600">{l.max_qty ?? '∞'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => removeLine.mutate(l.id)}
                    className="font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
