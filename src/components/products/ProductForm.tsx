'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Product, UnitOfMeasure } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { toast } from 'sonner'

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { organization } = useAuth()
  const supabase = createClient()

  const [name, setName] = useState(product?.name ?? '')
  const [skuCode, setSkuCode] = useState(product?.sku_code ?? '')
  const [ply, setPly] = useState(product?.ply?.toString() ?? '')
  const [gsm, setGsm] = useState(product?.gsm?.toString() ?? '')
  const [rollLength, setRollLength] = useState(product?.roll_length_ft?.toString() ?? '')
  const [sheetCount, setSheetCount] = useState(product?.sheet_count?.toString() ?? '')
  const [casePack, setCasePack] = useState(product?.case_pack_qty?.toString() ?? '')
  const [uom, setUom] = useState<UnitOfMeasure>(product?.unit_of_measure ?? 'case')

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        sku_code: skuCode,
        ply: ply ? Number(ply) : null,
        gsm: gsm ? Number(gsm) : null,
        roll_length_ft: rollLength ? Number(rollLength) : null,
        sheet_count: sheetCount ? Number(sheetCount) : null,
        case_pack_qty: casePack ? Number(casePack) : null,
        unit_of_measure: uom,
      }

      if (product) {
        const { error } = await supabase.from('products').update(payload).eq('id', product.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('products')
          .insert({ ...payload, organization_id: organization?.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(product ? 'SKU updated' : 'SKU created')
      router.push('/dashboard/products')
      router.refresh()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate()
      }}
      className="max-w-xl space-y-4 rounded-lg border border-gray-200 bg-white p-6"
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>SKU code</Label>
          <Input required value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="e.g. TT2-96-STD" />
        </div>
        <div>
          <Label>Name</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2-Ply Standard Bath Tissue" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Ply</Label>
          <Input type="number" min={1} value={ply} onChange={(e) => setPly(e.target.value)} />
        </div>
        <div>
          <Label>GSM</Label>
          <Input type="number" step="0.1" value={gsm} onChange={(e) => setGsm(e.target.value)} />
        </div>
        <div>
          <Label>Roll length (ft)</Label>
          <Input type="number" step="0.1" value={rollLength} onChange={(e) => setRollLength(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Sheet count</Label>
          <Input type="number" value={sheetCount} onChange={(e) => setSheetCount(e.target.value)} />
        </div>
        <div>
          <Label>Case pack qty</Label>
          <Input type="number" value={casePack} onChange={(e) => setCasePack(e.target.value)} />
        </div>
        <div>
          <Label>Unit of measure</Label>
          <Select value={uom} onChange={(e) => setUom(e.target.value as UnitOfMeasure)}>
            <option value="each">Each</option>
            <option value="roll">Roll</option>
            <option value="case">Case</option>
            <option value="pallet">Pallet</option>
          </Select>
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : product ? 'Save changes' : 'Create SKU'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
