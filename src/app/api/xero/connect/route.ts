// ============================================================
// GET /api/xero/connect — starts the Xero OAuth flow. Mirrors
// /api/quickbooks/connect exactly, plus one extra check: since
// only one accounting provider can be connected at a time, this
// refuses to start if QuickBooks is already connected for the org.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getXeroAuthUrl } from '@/lib/xero/server'
import { isAdminRole } from '@/lib/auth/roles'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!process.env.XERO_CLIENT_ID || !process.env.XERO_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'Xero sync is not configured yet (XERO_CLIENT_ID/SECRET missing).' },
      { status: 501 }
    )
  }

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

  if (!isAdminRole(profile?.role)) {
    return NextResponse.json(
      { error: 'Only an organization owner or administrator can connect Xero.' },
      { status: 403 }
    )
  }

  const admin = createAdminClient()
  const { data: existingQbo } = await admin
    .from('quickbooks_connections')
    .select('organization_id')
    .eq('organization_id', profile!.organization_id)
    .maybeSingle()
  if (existingQbo) {
    return NextResponse.json(
      { error: 'QuickBooks is already connected. Disconnect it in Settings before connecting Xero.' },
      { status: 409 }
    )
  }

  const origin = req.headers.get('origin') ?? new URL(req.url).origin
  const redirectUri = process.env.XERO_REDIRECT_URI || `${origin}/api/xero/callback`

  const state = randomBytes(16).toString('hex')
  const authUrl = getXeroAuthUrl(state, redirectUri)

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('xero_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
