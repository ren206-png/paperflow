// ============================================================
// GET /api/xero/callback — Xero redirects here after the user
// approves (or denies) the connection. Mirrors
// /api/quickbooks/callback exactly (CSRF state check, admin-role
// re-check, admin-client upsert since xero_connections has no
// client-facing RLS policy).
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForTokens } from '@/lib/xero/server'
import { isAdminRole } from '@/lib/auth/roles'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  const redirectTo = (query: string) =>
    NextResponse.redirect(`${url.origin}/dashboard/settings/integrations${query}`)

  if (errorParam) {
    return redirectTo(`?xero=error&reason=${encodeURIComponent(errorParam)}`)
  }

  const expectedState = req.cookies.get('xero_oauth_state')?.value
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectTo('?xero=error&reason=invalid_state')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return redirectTo('?xero=error&reason=not_authenticated')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return redirectTo('?xero=error&reason=no_organization')
  }

  if (!isAdminRole(profile.role)) {
    return redirectTo('?xero=error&reason=not_authorized')
  }

  const redirectUri = process.env.XERO_REDIRECT_URI || `${url.origin}/api/xero/callback`

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const admin = createAdminClient()

    const { data: existingQbo } = await admin
      .from('quickbooks_connections')
      .select('organization_id')
      .eq('organization_id', profile.organization_id)
      .maybeSingle()
    if (existingQbo) {
      return redirectTo('?xero=error&reason=quickbooks_already_connected')
    }

    const { error } = await admin.from('xero_connections').upsert({
      organization_id: profile.organization_id,
      tenant_id: tokens.tenantId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
      connected_at: new Date().toISOString(),
    })

    if (error) {
      return redirectTo(`?xero=error&reason=${encodeURIComponent(error.message)}`)
    }
  } catch (err) {
    return redirectTo(`?xero=error&reason=${encodeURIComponent((err as Error).message)}`)
  }

  const res = redirectTo('?xero=connected')
  res.cookies.delete('xero_oauth_state')
  return res
}
