'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { CostInput, Product } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { formatCurrency, cn } from '@/lib/utils'
import { toast } from 'sonner'

// A cost entry is flagged stale after this many days — surfaced as a
// trust signal (Phase 2.2 edge case #5: manual cost entry drift).
const STALE_AFTER_DAYS = 30

export default function CostInputsPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  const [productId, setProductId] = useState('')
  const [rawMaterial, setRawMaterial] = useState('')
  const [packaging, setPackaging] = useState('')
  const [labor, setLabor] = useState('')
  const [freight, setFreight] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('sku_code')
      if (error) throw error
      return data as Product[]
    },
  })

  const { data: costInputs, isLoading } = useQuery({
    queryKey: ['cost-inputs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cost_inputs')
        .select('*')
        .order('effective_date', { ascending: false })
      if (error) throw error
      return data as CostInput[]
    },
  })

  // Latest cost entry per product — reduced client-side since Supabase's
  // query builder can't express "latest per group" directly.
  const latestByProduct = useMemo(() => {
    const map = new Map<string, CostInput>()
    for (const ci of costInputs ?? []) {
      if (!map.has(ci.product_id)) map.set(ci.product_id, ci)
    }
    return map
  }, [costInputs])

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('cost_inputs').insert({
        organization_id: organization?.id,
        product_id: productId,
        raw_material_cost: Number(rawMaterial || 0),
        packaging_cost: Number(packaging || 0),
        labor_cost: Number(labor || 0),
        freight_cost_per_unit: Number(freight || 0),
        effective_date: effectiveDate,
        source: 'manual',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-inputs'] })
      toast.success('Cost entry saved')
      setProductId('')
      setRawMaterial('')
      setPackaging('')
      setLabor('')
      setFreight('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const isStale = (dateStr: string) => {
    const days = (Date.now() - new Date(dateStr).getTime()) / 86_400_000
    return days > STALE_AFTER_DAYS
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Cost Inputs</h1>
      <p className="mb-6 text-sm text-gray-500">
        Manually entered unit cost per SKU. There is no BOM/manufacturing costing engine at MVP —
        margin numbers are only as good as the latest entry here, which is why stale entries are flagged below.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
        className="mb-8 grid max-w-3xl grid-cols-6 gap-3 rounded-lg border border-gray-200 bg-white p-4 items-end"
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
          <Label>Raw material</Label>
          <Input type="number" step="0.0001" value={rawMaterial} onChange={(e) => setRawMaterial(e.target.value)} />
        </div>
        <div>
          <Label>Packaging</Label>
          <Input type="number" step="0.0001" value={packaging} onChange={(e) => setPackaging(e.target.value)} />
        </div>
        <div>
          <Label>Labor</Label>
          <Input type="number" step="0.0001" value={labor} onChange={(e) => setLabor(e.target.value)} />
        </div>
        <div>
          <Label>Freight/unit</Label>
          <Input type="number" step="0.0001" value={freight} onChange={(e) => setFreight(e.target.value)} />
        </div>
        <div className="col-span-5">
          <Label>Effective date</Label>
          <Input type="date" required value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
        <Button type="submit" disabled={mutation.isPending || !productId}>
          {mutation.isPending ? 'Saving…' : 'Add entry'}
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Raw material</th>
              <th className="px-4 py-3">Packaging</th>
              <th className="px-4 py-3">Labor</th>
              <th className="px-4 py-3">Freight</th>
              <th className="px-4 py-3">Total unit cost</th>
              <th className="px-4 py-3">Effective date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>Loading…</td></tr>
            )}
            {products?.map((p) => {
              const ci = latestByProduct.get(p.id)
              if (!ci) {
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.sku_code}</td>
                    <td className="px-4 py-3 text-gray-400 italic" colSpan={6}>No cost entered yet</td>
                  </tr>
                )
              }
              const total = ci.raw_material_cost + ci.packaging_cost + ci.labor_cost + ci.freight_cost_per_unit
              const stale = isStale(ci.effective_date)
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.sku_code}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(ci.raw_material_cost)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(ci.packaging_cost)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(ci.labor_cost)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(ci.freight_cost_per_unit)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{formatCurrency(total)}</td>
                  <td className="px-4 py-3">
                    <span className={cn(stale && 'font-semibold text-amber-600')}>
                      {ci.effective_date}
                      {stale && ' ⚠ stale'}
                    </span>
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
