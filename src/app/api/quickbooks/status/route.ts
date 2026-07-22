// ============================================================
// GET /api/quickbooks/status — returns whether the caller's org
// has an active QuickBooks connection. No tokens are ever returned
// here, just a boolean + realm ID, so any org member can call it
// (used to render the "Connected"/"Not connected" state in Settings).
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isQuickbooksConnected } from '@/lib/quickbooks/server'

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

  const status = await isQuickbooksConnected(profile.organization_id)
  return NextResponse.json(status)
}
