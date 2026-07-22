// ============================================================
// GET /api/xero/status — returns whether the caller's org has an
// active Xero connection. Mirrors /api/quickbooks/status. No
// tokens are ever returned, so any org member can call it.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isXeroConnected } from '@/lib/xero/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'No organization found for this user.' }, { status: 404 })
  }

  const status = await isXeroConnected(profile.organization_id)
  return NextResponse.json(status)
}
