'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Customer, MarginAlertReview, PriceBookLineMargin, Product } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
import { ALERT_THRESHOLD_PCT, activeMarginAlerts, suggestedRepriceUnitPrice } from '@/lib/margin/alerts'
import { toast } from 'sonner'

export default function MarginAlertsPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  // Target margin used to compute the *suggested* reprice — separate from
  // the alert threshold above. Editable because different orgs run
  // different healthy-margin targets; this never writes anywhere until
  // a rep clicks Apply on a specific line.
  const [targetMargin, setTargetMargin] = useState('20')

  const { data: lines, isLoading } = useQuery({
    queryKey: ['price-book-line-margins'],
    queryFn: async () => {
      const { data, error } = await supabase.from('price_book_line_margins').select('*')
      if (error) throw error
      return data as PriceBookLineMargin[]
    },
  })

  const { data: reviews } = useQuery({
    queryKey: ['margin-alert-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('margin_alert_reviews')
        .select('*')
        .order('reviewed_cost_effective_date', { ascending: false })
      if (error) throw error
      return data as MarginAlertReview[]
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
  const customerNameFor = (id: string | null) =>
    id ? customers?.find((c) => c.id === id)?.name ?? 'Unknown customer' : 'Org default / list price'

  const alerts = useMemo(() => activeMarginAlerts(lines ?? [], reviews ?? []), [lines, reviews])

  const suggestedPrice = (cost: number) => suggestedRepriceUnitPrice(cost, Number(targetMargin))

  const reprice = useMutation({
    mutationFn: async (line: PriceBookLineMargin) => {
      if (line.current_unit_cost === null || !line.cost_effective_date) {
        throw new Error('No cost on file for this SKU yet.')
      }
      const newPrice = suggestedPrice(line.current_unit_cost)

      const { error: priceError } = await supabase
        .from('price_book_lines')
        .update({ unit_price: newPrice })
        .eq('id', line.price_book_line_id)
      if (priceError) throw priceError

      const { error: reviewError } = await supabase.from('margin_alert_reviews').insert({
        organization_id: organization?.id,
        price_book_line_id: line.price_book_line_id,
        reviewed_cost_effective_date: line.cost_effective_date,
        action: 'repriced',
        previous_unit_price: line.unit_price,
        new_unit_price: newPrice,
      })
      if (reviewError) throw reviewError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-book-line-margins'] })
      queryClient.invalidateQueries({ queryKey: ['margin-alert-reviews'] })
      toast.success('Price updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const dismiss = useMutation({
    mutationFn: async (line: PriceBookLineMargin) => {
      if (!line.cost_effective_date) throw new Error('No cost on file for this SKU yet.')
      const { error } = await supabase.from('margin_alert_reviews').insert({
        organization_id: organization?.id,
        price_book_line_id: line.price_book_line_id,
        reviewed_cost_effective_date: line.cost_effective_date,
        action: 'dismissed',
        previous_unit_price: line.unit_price,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['margin-alert-reviews'] })
      toast.success('Alert dismissed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Margin Alerts</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Every price book line whose margin has fallen below {ALERT_THRESHOLD_PCT}% given the latest
            cost on file — most often because a raw material, packaging, labor, or freight cost went up
            and the customer price was never revisited. Nothing here changes a price automatically; you
            review each line and choose Apply or Dismiss.
          </p>
        </div>
        <div className="w-40 shrink-0">
          <Label>Target margin for reprice</Label>
          <div className="relative">
            <Input
              type="number"
              step="0.1"
              value={targetMargin}
              onChange={(e) => setTargetMargin(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Price book</th>
              <th className="px-4 py-3">Current price</th>
              <th className="px-4 py-3">Current cost</th>
              <th className="px-4 py-3">Margin</th>
              <th className="px-4 py-3">Cost as of</th>
              <th className="px-4 py-3">Suggested price</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td className="px-4 py-6 text-gray-500" colSpan={8}>Loading…</td></tr>}
            {!isLoading && alerts.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-gray-500" colSpan={8}>
                  No margin alerts right now — every priced SKU is at or above {ALERT_THRESHOLD_PCT}% margin.
                </td>
              </tr>
            )}
            {alerts.map((l) => {
              const suggested = l.current_unit_cost !== null ? suggestedPrice(l.current_unit_cost) : null
              return (
                <tr key={l.price_book_line_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{skuFor(l.product_id)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {l.price_book_name}
                    <span className="block text-xs text-gray-400">{customerNameFor(l.customer_id)}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(l.unit_price)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {l.current_unit_cost !== null ? formatCurrency(l.current_unit_cost) : '—'}
                  </td>
                  <td className={cn('px-4 py-3 font-semibold', 'text-red-600')}>
                    {l.margin_pct !== null ? formatPercent(l.margin_pct) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{l.cost_effective_date ?? '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {suggested !== null ? formatCurrency(suggested) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => dismiss.mutate(l)}
                        disabled={dismiss.isPending || reprice.isPending}
                        className="font-medium text-gray-500 hover:underline disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      <Button
                        onClick={() => reprice.mutate(l)}
                        disabled={reprice.isPending || dismiss.isPending || suggested === null}
                      >
                        {reprice.isPending ? 'Applying…' : 'Apply'}
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
