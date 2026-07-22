'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { CustomerForm } from '@/components/customers/CustomerForm'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { Customer, UserProfile } from '@/types'
import { isUUID } from '@/lib/utils'
import { toast } from 'sonner'

export default function EditCustomerPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const { isOrgAdmin } = useAuth()
  const isValidId = isUUID(params.id)
  const [inviteEmail, setInviteEmail] = useState('')

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customers', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').eq('id', params.id).single()
      if (error) throw error
      return data as Customer
    },
  })

  const { data: portalUser } = useQuery({
    queryKey: ['customer-portal-user', params.id],
    enabled: isValidId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('customer_id', params.id)
        .eq('role', 'client_viewer')
        .maybeSingle()
      if (error) throw error
      return data as UserProfile | null
    },
  })

  const invite = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/customers/${params.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not send the invite.')
      return body
    },
    onSuccess: () => {
      toast.success('Portal invite sent.')
      setInviteEmail('')
      queryClient.invalidateQueries({ queryKey: ['customer-portal-user', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const revoke = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/customers/${params.id}/invite`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not revoke portal access.')
      return body
    },
    onSuccess: () => {
      toast.success('Portal access revoked.')
      queryClient.invalidateQueries({ queryKey: ['customer-portal-user', params.id] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!isValidId) return <p className="text-gray-500">Customer not found.</p>
  if (isLoading) return <p className="text-gray-500">Loading…</p>
  if (!customer) return <p className="text-gray-500">Customer not found.</p>

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Edit customer</h1>
      <CustomerForm customer={customer} />

      <div className="mt-8 max-w-lg rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-lg font-semibold text-gray-900">Customer portal access</p>
        <p className="mt-1 text-sm text-gray-500">
          Invite this customer to a read-only portal where they can view their own quotes, orders, and invoices.
          Only one portal user is allowed per customer at a time.
        </p>

        {portalUser && (
          <div className="mt-4 flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
            <div>
              <span className="text-gray-700">{portalUser.email}</span>
              <span className="ml-2 capitalize text-gray-500">({portalUser.status})</span>
            </div>
            {isOrgAdmin && (
              <Button variant="secondary" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
                {revoke.isPending ? 'Removing…' : 'Remove access'}
              </Button>
            )}
          </div>
        )}

        {!isOrgAdmin ? (
          <p className="mt-3 text-sm text-amber-600">
            Only an organization owner or administrator can manage portal access for this customer.
          </p>
        ) : !portalUser ? (
          <div className="mt-4 flex gap-2">
            <Input
              type="email"
              placeholder="customer@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <Button
              onClick={() => invite.mutate(inviteEmail)}
              disabled={invite.isPending || !inviteEmail.includes('@')}
            >
              {invite.isPending ? 'Sending…' : 'Invite to portal'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
