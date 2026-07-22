// ============================================================
// POST /api/customers/:id/invite — admin-only. Invites an email
// to the read-only customer portal, scoped to this one customer.
// Uses the admin client (service role) for both the Supabase Auth
// invite and the user_profiles insert, since a client_viewer row
// must never be creatable by the invitee themselves.
//
// Only one portal user is allowed per customer at a time (mirrors
// the one-provider-at-a-time rule for accounting sync) — an admin
// must revoke the existing portal user (DELETE, below) before
// inviting a different one.
//
// DELETE /api/customers/:id/invite — admin-only. Revokes a portal
// user's access: deletes their user_profiles row (which alone is
// sufficient — my_org_id()/my_customer_id() both resolve via a
// lookup keyed on that row, so a missing row means every RLS check
// they depend on fails closed), then deletes the underlying auth
// user so the invite can't be silently reused.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRole } from '@/lib/auth/roles'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'No organization found for this user.' }, { status: 404 })
  }
  if (!isAdminRole(profile.role)) {
    return NextResponse.json(
      { error: 'Only an organization owner or administrator can invite customers to the portal.' },
      { status: 403 }
    )
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, name')
    .eq('id', params.id)
    .single()
  if (customerError || !customer) {
    return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('user_profiles')
    .select('id, email, status')
    .eq('customer_id', customer.id)
    .eq('role', 'client_viewer')
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      {
        error: `${customer.name} already has a portal user (${existing.email}, status: ${existing.status}). Remove them before inviting someone else — only one portal user is allowed per customer at a time.`,
      },
      { status: 400 }
    )
  }

  const origin = req.headers.get('origin') ?? new URL(req.url).origin

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/portal/set-password`,
  })
  if (inviteError || !invited.user) {
    return NextResponse.json({ error: inviteError?.message ?? 'Could not send the invite.' }, { status: 502 })
  }

  const { error: profileError } = await admin.from('user_profiles').insert({
    auth_user_id: invited.user.id,
    organization_id: profile.organization_id,
    customer_id: customer.id,
    email,
    full_name: typeof body.fullName === 'string' && body.fullName.trim() ? body.fullName.trim() : email,
    role: 'client_viewer',
    status: 'invited',
  })
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'No organization found for this user.' }, { status: 404 })
  }
  if (!isAdminRole(profile.role)) {
    return NextResponse.json(
      { error: 'Only an organization owner or administrator can revoke portal access.' },
      { status: 403 }
    )
  }

  const admin = createAdminClient()

  const { data: portalUser, error: portalUserError } = await admin
    .from('user_profiles')
    .select('id, auth_user_id, organization_id')
    .eq('customer_id', params.id)
    .eq('role', 'client_viewer')
    .maybeSingle()
  if (portalUserError || !portalUser) {
    return NextResponse.json({ error: 'No portal user found for this customer.' }, { status: 404 })
  }
  if (portalUser.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not authorized to revoke this portal user.' }, { status: 403 })
  }

  const { error: deleteProfileError } = await admin.from('user_profiles').delete().eq('id', portalUser.id)
  if (deleteProfileError) {
    return NextResponse.json({ error: deleteProfileError.message }, { status: 500 })
  }

  // Access is already revoked at this point (RLS closes without a profile
  // row); deleting the auth user too just prevents the invite link/login
  // from being reused.
  await admin.auth.admin.deleteUser(portalUser.auth_user_id)

  return NextResponse.json({ ok: true })
}
