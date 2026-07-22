// ============================================================
// POST /api/xero/disconnect — deletes the org's stored Xero
// connection row. Mirrors /api/quickbooks/disconnect. Does not
// revoke the token with Xero (best effort MVP); the user can also
// revoke access from their Xero account if needed.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRole } from '@/lib/auth/roles'

export const runtime = 'nodejs'

export async function POST() {
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
      { error: 'Only an organization owner or administrator can disconnect Xero.' },
      { status: 403 }
    )
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('xero_connections')
    .delete()
    .eq('organization_id', profile.organization_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
