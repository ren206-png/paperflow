// ============================================================
// GET /api/quickbooks/callback — Intuit redirects here after the
// user approves (or denies) the connection. Verifies the CSRF
// state cookie set in /connect, exchanges the code for tokens, and
// persists them on the caller's organization (cookie-scoped client,
// so this is still gated by the organizations_update RLS policy —
// only an org admin can complete a connection).
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForTokens } from '@/lib/quickbooks/server'
import { isAdminRole } from '@/lib/auth/roles'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const realmId = url.searchParams.get('realmId')
  const errorParam = url.searchParams.get('error')

  const redirectTo = (query: string) =>
    NextResponse.redirect(`${url.origin}/dashboard/settings/integrations${query}`)

  if (errorParam) {
    return redirectTo(`?quickbooks=error&reason=${encodeURIComponent(errorParam)}`)
  }

  const expectedState = req.cookies.get('qbo_oauth_state')?.value
  if (!code || !realmId || !state || !expectedState || state !== expectedState) {
    return redirectTo('?quickbooks=error&reason=invalid_state')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return redirectTo('?quickbooks=error&reason=not_authenticated')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return redirectTo('?quickbooks=error&reason=no_organization')
  }

  if (!isAdminRole(profile.role)) {
    return redirectTo('?quickbooks=error&reason=not_authorized')
  }

  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${url.origin}/api/quickbooks/callback`

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // quickbooks_connections has no client-facing RLS policy at all
    // (tokens must never be selectable from the browser), so this
    // write has to go through the admin client — authorization was
    // already established above via the profile role check.
    const admin = createAdminClient()
    const { error } = await admin.from('quickbooks_connections').upsert({
      organization_id: profile.organization_id,
      realm_id: realmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
      connected_at: new Date().toISOString(),
    })

    if (error) {
      return redirectTo(`?quickbooks=error&reason=${encodeURIComponent(error.message)}`)
    }
  } catch (err) {
    return redirectTo(`?quickbooks=error&reason=${encodeURIComponent((err as Error).message)}`)
  }

  const res = redirectTo('?quickbooks=connected')
  res.cookies.delete('qbo_oauth_state')
  return res
}
