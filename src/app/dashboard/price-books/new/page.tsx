'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Customer } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { toast } from 'sonner'

export default function NewPriceBookPage() {
  const router = useRouter()
  const supabase = createClient()
  const { organization } = useAuth()

  const [name, setName] = useState('')
  const [customerId, setCustomerId] = useState('') // '' = org-wide default
  const [isContract, setIsContract] = useState(true)
  const [effectiveStart, setEffectiveStart] = useState(() => new Date().toISOString().slice(0, 10))
  const [effectiveEnd, setEffectiveEnd] = useState('')

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').order('name')
      if (error) throw error
      return data as Customer[]
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('price_books')
        .insert({
          organization_id: organization?.id,
          customer_id: customerId || null,
          name,
          is_contract: isContract,
          effective_start: effectiveStart,
          effective_end: effectiveEnd || null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      toast.success('Price book created — now add product lines')
      router.push(`/dashboard/price-books/${data.id}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">New price book</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
        className="max-w-xl space-y-4 rounded-lg border border-gray-200 bg-white p-6"
      >
        <div>
          <Label>Name</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Distributors — 2026 Contract" />
        </div>
        <div>
          <Label>Customer</Label>
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Org-wide default / list price</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="is_contract"
            type="checkbox"
            checked={isContract}
            onChange={(e) => setIsContract(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          <label htmlFor="is_contract" className="text-sm text-gray-700">
            This is a negotiated contract price (vs. a general volume/list book)
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Effective start</Label>
            <Input type="date" required value={effectiveStart} onChange={(e) => setEffectiveStart(e.target.value)} />
          </div>
          <div>
            <Label>Effective end (optional)</Label>
            <Input type="date" value={effectiveEnd} onChange={(e) => setEffectiveEnd(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create & add lines'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
