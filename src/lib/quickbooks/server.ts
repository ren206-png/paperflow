// ============================================================
// QuickBooks Online (Intuit) API client — plain fetch, no SDK.
// SERVER-ONLY: handles OAuth token exchange/refresh and the
// Accounting API calls needed to push an invoice.
//
// NOTE: written against Intuit's documented OAuth2 + Accounting
// API v3 shapes, but has not been exercised against a live QBO
// sandbox in this environment (no network access here). Test
// against a real Intuit developer sandbox before relying on it.
// ============================================================
import { createAdminClient } from '@/lib/supabase/admin'

const DISCOVERY_ENV = process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox'

const OAUTH_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

function apiBase(realmId: string) {
  const host = DISCOVERY_ENV === 'production' ? 'quickbooks.api.intuit.com' : 'sandbox-quickbooks.api.intuit.com'
  return `https://${host}/v3/company/${realmId}`
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

export function getQuickbooksAuthUrl(state: string, redirectUri: string): string {
  const clientId = requireEnv('QUICKBOOKS_CLIENT_ID')
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri,
    state,
  })
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

function basicAuthHeader(): string {
  const clientId = requireEnv('QUICKBOOKS_CLIENT_ID')
  const clientSecret = requireEnv('QUICKBOOKS_CLIENT_SECRET')
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) {
    throw new Error(`QuickBooks token exchange failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    throw new Error(`QuickBooks token refresh failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

interface QboConnectionRow {
  realm_id: string
  access_token: string
  refresh_token: string
  token_expires_at: string
}

/**
 * Returns a valid access token + realm ID for the org, refreshing
 * and persisting new tokens first if the stored one is expired (or
 * about to expire). Returns null if the org has never connected
 * QuickBooks. Uses the admin client since quickbooks_connections has
 * no client-facing RLS policy at all (tokens must never reach the
 * browser) — this can be invoked by any org member, not just the
 * admin who originally connected it.
 */
export async function getValidAccessToken(
  organizationId: string
): Promise<{ accessToken: string; realmId: string } | null> {
  const admin = createAdminClient()
  const { data: conn, error } = await admin
    .from('quickbooks_connections')
    .select('realm_id, access_token, refresh_token, token_expires_at')
    .eq('organization_id', organizationId)
    .maybeSingle<QboConnectionRow>()

  if (error || !conn) {
    return null
  }

  const expiresAt = new Date(conn.token_expires_at).getTime()
  const stillValid = expiresAt - Date.now() > 60_000 // 60s buffer

  if (stillValid) {
    return { accessToken: conn.access_token, realmId: conn.realm_id }
  }

  const refreshed = await refreshTokens(conn.refresh_token)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

  await admin
    .from('quickbooks_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq('organization_id', organizationId)

  return { accessToken: refreshed.access_token, realmId: conn.realm_id }
}

/**
 * True if this org has an active QuickBooks connection. Safe to call
 * from a route that just needs a status flag for the UI (no tokens
 * are returned).
 */
export async function isQuickbooksConnected(organizationId: string): Promise<{ connected: boolean; realmId: string | null }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('quickbooks_connections')
    .select('realm_id')
    .eq('organization_id', organizationId)
    .maybeSingle<{ realm_id: string }>()
  return { connected: !!data, realmId: data?.realm_id ?? null }
}

async function qboFetch(realmId: string, accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${apiBase(realmId)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`QuickBooks API error (${path}): ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/**
 * Finds a QBO Customer by DisplayName, creating one if none exists.
 * Returns the QBO Customer Id.
 */
export async function findOrCreateQboCustomer(
  realmId: string,
  accessToken: string,
  customerName: string
): Promise<string> {
  const escaped = customerName.replace(/'/g, "\\'")
  const query = `select Id from Customer where DisplayName = '${escaped}'`
  const searchResult = await qboFetch(realmId, accessToken, `/query?query=${encodeURIComponent(query)}`)
  const existing = searchResult?.QueryResponse?.Customer?.[0]
  if (existing?.Id) return existing.Id as string

  const created = await qboFetch(realmId, accessToken, '/customer', {
    method: 'POST',
    body: JSON.stringify({ DisplayName: customerName }),
  })
  return created.Customer.Id as string
}

/**
 * Finds a QBO non-inventory Item by name (SKU), creating one against
 * the org's default income account if none exists. QBO requires an
 * IncomeAccountRef; we look up the first "Income" type account.
 */
export async function findOrCreateQboItem(
  realmId: string,
  accessToken: string,
  itemName: string
): Promise<string> {
  const escaped = itemName.replace(/'/g, "\\'")
  const query = `select Id from Item where Name = '${escaped}'`
  const searchResult = await qboFetch(realmId, accessToken, `/query?query=${encodeURIComponent(query)}`)
  const existing = searchResult?.QueryResponse?.Item?.[0]
  if (existing?.Id) return existing.Id as string

  const accountResult = await qboFetch(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent("select Id from Account where AccountType = 'Income' maxresults 1")}`
  )
  const incomeAccountId = accountResult?.QueryResponse?.Account?.[0]?.Id
  if (!incomeAccountId) {
    throw new Error('No income account found in QuickBooks — create one before syncing invoices.')
  }

  const created = await qboFetch(realmId, accessToken, '/item', {
    method: 'POST',
    body: JSON.stringify({
      Name: itemName,
      Type: 'NonInventory',
      IncomeAccountRef: { value: incomeAccountId },
    }),
  })
  return created.Item.Id as string
}

export interface QboInvoiceLineInput {
  itemId: string
  description: string
  qty: number
  unitPrice: number
}

/**
 * Creates a QBO Invoice and returns its Id.
 */
export async function createQboInvoice(
  realmId: string,
  accessToken: string,
  qboCustomerId: string,
  lines: QboInvoiceLineInput[]
): Promise<string> {
  const created = await qboFetch(realmId, accessToken, '/invoice', {
    method: 'POST',
    body: JSON.stringify({
      CustomerRef: { value: qboCustomerId },
      Line: lines.map((l) => ({
        Amount: Math.round(l.qty * l.unitPrice * 100) / 100,
        DetailType: 'SalesItemLineDetail',
        Description: l.description,
        SalesItemLineDetail: {
          ItemRef: { value: l.itemId },
          Qty: l.qty,
          UnitPrice: l.unitPrice,
        },
      })),
    }),
  })
  return created.Invoice.Id as string
}
