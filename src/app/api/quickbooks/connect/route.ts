// ============================================================
// GET /api/quickbooks/connect — starts the QuickBooks Online OAuth
// flow. Only meaningful for an org admin (organizations_update RLS
// enforces this when the callback later persists tokens). Stores a
// CSRF nonce in a short-lived httpOnly cookie, checked in the
// callback before we trust the returned `state`.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getQuickbooksAuthUrl } from '@/lib/quickbooks/server'
import { isAdminRole } from '@/lib/auth/roles'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!process.env.QUICKBOOKS_CLIENT_ID || !process.env.QUICKBOOKS_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'QuickBooks sync is not configured yet (QUICKBOOKS_CLIENT_ID/SECRET missing).' },
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
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!isAdminRole(profile?.role)) {
    return NextResponse.json(
      { error: 'Only an organization owner or administrator can connect QuickBooks.' },
      { status: 403 }
    )
  }

  const origin = req.headers.get('origin') ?? new URL(req.url).origin
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${origin}/api/quickbooks/callback`

  const state = randomBytes(16).toString('hex')
  const authUrl = getQuickbooksAuthUrl(state, redirectUri)

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
