'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Customer, PriceBook, Product } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
import { resolvePriceBookId, resolveUnitPrice, getLatestCostInput, totalUnitCost, marginPct } from '@/lib/pricing/resolve'
import { toast } from 'sonner'

interface DraftLine {
  key: string
  productId: string
  skuCode: string
  qty: number
  unitPrice: number
  unitCostSnapshot: number
  costEffectiveDate: string | null
  manualPrice: boolean
}

export default function NewQuotePage() {
  const router = useRouter()
  const supabase = createClient()
  const { organization } = useAuth()

  const [customerId, setCustomerId] = useState('')
  const [priceBookId, setPriceBookId] = useState<string | null>(null)
  const [priceBookLookupDone, setPriceBookLookupDone] = useState(false)

  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [isResolvingLine, setIsResolvingLine] = useState(false)

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').order('name')
      if (error) throw error
      return data as Customer[]
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

  const { data: priceBook } = useQuery({
    queryKey: ['price-books', priceBookId],
    enabled: !!priceBookId,
    queryFn: async () => {
      const { data, error } = await supabase.from('price_books').select('*').eq('id', priceBookId!).single()
      if (error) throw error
      return data as PriceBook
    },
  })

  async function handleCustomerChange(id: string) {
    setCustomerId(id)
    setLines([])
    setPriceBookLookupDone(false)
    if (!id) {
      setPriceBookId(null)
      return
    }
    const resolved = await resolvePriceBookId(supabase, id)
    setPriceBookId(resolved)
    setPriceBookLookupDone(true)
  }

  async function handleAddLine() {
    if (!productId || !customerId) return
    setIsResolvingLine(true)
    try {
      const qtyNum = Number(qty) || 1
      const product = products?.find((p) => p.id === productId)
      const [resolvedPrice, cost] = await Promise.all([
        resolveUnitPrice(supabase, customerId, productId, qtyNum),
        getLatestCostInput(supabase, productId),
      ])

      if (resolvedPrice === null) {
        toast.warning('No price tier matched this quantity/customer — enter a price manually.')
      }
      if (!cost) {
        toast.warning('No cost entered for this SKU yet — margin will show as 100% until you add one.')
      }

      setLines((prev) => [
        ...prev,
        {
          key: crypto.randomUUID(),
          productId,
          skuCode: product?.sku_code ?? productId,
          qty: qtyNum,
          unitPrice: resolvedPrice ?? 0,
          unitCostSnapshot: cost ? totalUnitCost(cost) : 0,
          costEffectiveDate: cost?.effective_date ?? null,
          manualPrice: resolvedPrice === null,
        },
      ])
      setProductId('')
      setQty('1')
    } finally {
      setIsResolvingLine(false)
    }
  }

  function updateLinePrice(key: string, value: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, unitPrice: Number(value) || 0, manualPrice: true } : l)))
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  const quoteTotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)
  const totalCost = lines.reduce((sum, l) => sum + l.qty * l.unitCostSnapshot, 0)
  const blendedMargin = quoteTotal > 0 ? marginPct(quoteTotal, totalCost) : 0

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error('Add at least one line before saving.')

      const { data: quote, error: quoteError } = await supabase
        .from('quotes')
        .insert({
          organization_id: organization?.id,
          customer_id: customerId,
          price_book_id: priceBookId,
          status: 'draft',
        })
        .select()
        .single()
      if (quoteError) throw quoteError

      const { error: linesError } = await supabase.from('quote_lines').insert(
        lines.map((l) => ({
          quote_id: quote.id,
          product_id: l.productId,
          qty: l.qty,
          unit_price: l.unitPrice,
          unit_cost_snapshot: l.unitCostSnapshot,
          cost_effective_date: l.costEffectiveDate,
        }))
      )
      if (linesError) throw linesError

      return quote
    },
    onSuccess: (quote) => {
      toast.success('Quote saved as draft')
      router.push(`/dashboard/quotes/${quote.id}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">New quote</h1>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <Label>Customer</Label>
        <Select value={customerId} onChange={(e) => handleCustomerChange(e.target.value)}>
          <option value="">Select customer…</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        {customerId && priceBookLookupDone && (
          <p className="mt-2 text-sm text-gray-500">
            {priceBook ? (
              <>Pricing from: <span className="font-medium text-gray-800">{priceBook.name}</span></>
            ) : (
              <span className="text-amber-600">No active price book for this customer — line prices will need manual entry.</span>
            )}
          </p>
        )}
      </div>

      {customerId && (
        <div className="mb-6 grid grid-cols-4 items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="col-span-2">
            <Label>Product</Label>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select SKU…</option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>{p.sku_code} — {p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Qty</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button type="button" onClick={handleAddLine} disabled={!productId || isResolvingLine}>
            {isResolvingLine ? 'Pricing…' : 'Add line'}
          </Button>
        </div>
      )}

      {lines.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Unit price</th>
                <th className="px-4 py-3">Unit cost</th>
                <th className="px-4 py-3">Line total</th>
                <th className="px-4 py-3">Margin</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l) => {
                const margin = marginPct(l.unitPrice, l.unitCostSnapshot)
                return (
                  <tr key={l.key}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{l.skuCode}</td>
                    <td className="px-4 py-3 text-gray-600">{l.qty}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.0001"
                        value={l.unitPrice}
                        onChange={(e) => updateLinePrice(l.key, e.target.value)}
                        className={cn(
                          'w-24 rounded border px-2 py-1 text-sm',
                          l.manualPrice ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                        )}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unitCostSnapshot)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(l.qty * l.unitPrice)}</td>
                    <td className={cn('px-4 py-3 font-semibold', margin < 15 ? 'text-red-600' : 'text-green-700')}>
                      {formatPercent(margin)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeLine(l.key)} className="font-medium text-red-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3" colSpan={4}>Total</td>
                <td className="px-4 py-3">{formatCurrency(quoteTotal)}</td>
                <td className={cn('px-4 py-3', blendedMargin < 15 ? 'text-red-600' : 'text-green-700')}>
                  {formatPercent(blendedMargin)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || lines.length === 0}>
          {saveMutation.isPending ? 'Saving…' : 'Save quote as draft'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
