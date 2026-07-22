'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import type { Customer, CustomerType } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { toast } from 'sonner'

export function CustomerForm({ customer }: { customer?: Customer }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { organization } = useAuth()
  const supabase = createClient()

  const [name, setName] = useState(customer?.name ?? '')
  const [customerType, setCustomerType] = useState<CustomerType>(customer?.customer_type ?? 'wholesaler')
  const [contactName, setContactName] = useState(customer?.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(customer?.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(customer?.contact_phone ?? '')
  const [creditTerms, setCreditTerms] = useState(customer?.credit_terms ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        customer_type: customerType,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        credit_terms: creditTerms || null,
        notes: notes || null,
      }

      if (customer) {
        const { error } = await supabase.from('customers').update(payload).eq('id', customer.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('customers')
          .insert({ ...payload, organization_id: organization?.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      toast.success(customer ? 'Customer updated' : 'Customer created')
      router.push('/dashboard/customers')
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
      <div>
        <Label>Company name</Label>
        <Input required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label>Customer type</Label>
        <Select value={customerType} onChange={(e) => setCustomerType(e.target.value as CustomerType)}>
          <option value="distributor">Distributor</option>
          <option value="institution">Institution</option>
          <option value="wholesaler">Wholesaler</option>
          <option value="other">Other</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Contact name</Label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div>
          <Label>Contact phone</Label>
          <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Contact email</Label>
        <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
      </div>
      <div>
        <Label>Credit terms</Label>
        <Input placeholder="e.g. Net 30" value={creditTerms} onChange={(e) => setCreditTerms(e.target.value)} />
      </div>
      <div>
        <Label>Notes</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : customer ? 'Save changes' : 'Create customer'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
