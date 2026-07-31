// ============================================================
// Xero API client — plain fetch, no SDK. Mirrors
// src/lib/quickbooks/server.ts's shape exactly (same function
// names/signatures where the concepts line up).
// SERVER-ONLY: handles OAuth token exchange/refresh and the
// Accounting API calls needed to push an invoice.
//
// Unlike QBO, Xero has no separate "Item" catalog requirement —
// an invoice LineItem can carry Description/Quantity/UnitAmount
// directly, so there's no findOrCreateXeroItem. It does require an
// AccountCode (a sales/revenue account) per line, resolved via
// getDefaultSalesAccountCode instead.
//
// NOTE: written against Xero's documented OAuth2 + Accounting API
// shapes, but has not been exercised against a live Xero
// sandbox/demo company in this environment (no network access
// here). Test against a real Xero developer app before relying on
// it, the same way the QuickBooks integration was verified.
// ============================================================
import { createAdminClient } from '@/lib/supabase/admin'

const OAUTH_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
const OAUTH_TOKEN_URL = 'https://identity.xero.com/connect/token'
const CONNECTIONS_URL = 'https://api.xero.com/connections'
const API_BASE = 'https://api.xero.com/api.xro/2.0'

// Xero rolled out granular scopes replacing the old broad ones (apps
// created after 2 March 2026, like this one, only have access to the
// new set — the old "accounting.transactions" scope no longer exists
// and requesting it fails OAuth with `invalid_scope`, confirmed against
// a live Xero sandbox app). accounting.contacts covers read+write for
// findOrCreateXeroContact; accounting.invoices covers read+write for
// createXeroInvoice; accounting.settings.read covers the Chart of
// Accounts lookup in getDefaultSalesAccountCode (read-only, so the
// narrower .read variant is used).
const SCOPES =
  'openid profile email accounting.contacts accounting.settings.read accounting.invoices offline_access'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured.`)
  return value
}

export function getXeroAuthUrl(state: string, redirectUri: string): string {
  const clientId = requireEnv('XERO_CLIENT_ID')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
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
  const clientId = requireEnv('XERO_CLIENT_ID')
  const clientSecret = requireEnv('XERO_CLIENT_SECRET')
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Xero token request failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

interface XeroConnection {
  tenantId: string
}

async function getFirstTenantId(accessToken: string): Promise<string> {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Could not list Xero connections: ${res.status} ${await res.text()}`)
  }
  const connections: XeroConnection[] = await res.json()
  const tenantId = connections[0]?.tenantId
  if (!tenantId) {
    throw new Error('No Xero organisation was authorized during consent.')
  }
  return tenantId
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<TokenResponse & { tenantId: string }> {
  const tokens = await requestTokens(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  )
  const tenantId = await getFirstTenantId(tokens.access_token)
  return { ...tokens, tenantId }
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return requestTokens(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }))
}

interface XeroConnectionRow {
  tenant_id: string
  access_token: string
  refresh_token: string
  token_expires_at: string
}

/**
 * Returns a valid access token + tenant ID for the org, refreshing
 * and persisting new tokens first if the stored one is expired (or
 * about to expire). Returns null if the org has never connected
 * Xero. Uses the admin client since xero_connections has no
 * client-facing RLS policy at all (tokens must never reach the
 * browser).
 */
export async function getValidAccessToken(
  organizationId: string
): Promise<{ accessToken: string; tenantId: string } | null> {
  const admin = createAdminClient()
  const { data: conn, error } = await admin
    .from('xero_connections')
    .select('tenant_id, access_token, refresh_token, token_expires_at')
    .eq('organization_id', organizationId)
    .maybeSingle<XeroConnectionRow>()

  if (error || !conn) {
    return null
  }

  const expiresAt = new Date(conn.token_expires_at).getTime()
  const stillValid = expiresAt - Date.now() > 60_000 // 60s buffer

  if (stillValid) {
    return { accessToken: conn.access_token, tenantId: conn.tenant_id }
  }

  const refreshed = await refreshTokens(conn.refresh_token)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

  await admin
    .from('xero_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq('organization_id', organizationId)

  return { accessToken: refreshed.access_token, tenantId: conn.tenant_id }
}

/**
 * True if this org has an active Xero connection. Safe to call from
 * a route that just needs a status flag for the UI (no tokens are
 * returned).
 */
export async function isXeroConnected(organizationId: string): Promise<{ connected: boolean; tenantId: string | null }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('xero_connections')
    .select('tenant_id')
    .eq('organization_id', organizationId)
    .maybeSingle<{ tenant_id: string }>()
  return { connected: !!data, tenantId: data?.tenant_id ?? null }
}

async function xeroFetch(tenantId: string, accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Xero API error (${path}): ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/**
 * Finds a Xero Contact by Name, creating one if none exists.
 * Returns the Xero ContactID.
 */
export async function findOrCreateXeroContact(
  tenantId: string,
  accessToken: string,
  customerName: string
): Promise<string> {
  const escaped = customerName.replace(/"/g, '\\"')
  const where = `Name=="${escaped}"`
  const searchResult = await xeroFetch(tenantId, accessToken, `/Contacts?where=${encodeURIComponent(where)}`)
  const existing = searchResult?.Contacts?.[0]
  if (existing?.ContactID) return existing.ContactID as string

  const created = await xeroFetch(tenantId, accessToken, '/Contacts', {
    method: 'POST',
    body: JSON.stringify({ Contacts: [{ Name: customerName }] }),
  })
  return created.Contacts[0].ContactID as string
}

/**
 * Resolves the AccountCode of the org's first revenue/sales account
 * in the connected Xero organisation — required on every invoice
 * LineItem since Xero has no per-product "Item" catalog requirement.
 */
export async function getDefaultSalesAccountCode(tenantId: string, accessToken: string): Promise<string> {
  const where = `Class=="REVENUE" AND Status=="ACTIVE"`
  const result = await xeroFetch(tenantId, accessToken, `/Accounts?where=${encodeURIComponent(where)}`)
  const code = result?.Accounts?.[0]?.Code
  if (!code) {
    throw new Error('No active revenue account found in Xero — create one before syncing invoices.')
  }
  return code as string
}

export interface XeroInvoiceLineInput {
  description: string
  qty: number
  unitPrice: number
  accountCode: string
}

/**
 * Creates a Xero Invoice (Type ACCREC — accounts receivable / sales
 * invoice) and returns its InvoiceID.
 *
 * DueDate is required by Xero whenever Status is AUTHORISED (confirmed
 * live: omitting it fails with "The document DueDate field must be
 * specified"), unlike QuickBooks which defaults due date server-side
 * when none is sent. PlyCount has no payment-terms concept yet, so
 * this defaults to net-30 from today.
 */
export async function createXeroInvoice(
  tenantId: string,
  accessToken: string,
  xeroContactId: string,
  lines: XeroInvoiceLineInput[]
): Promise<string> {
  const today = new Date()
  const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
  const isoDate = (d: Date) => d.toISOString().slice(0, 10)

  const created = await xeroFetch(tenantId, accessToken, '/Invoices', {
    method: 'POST',
    body: JSON.stringify({
      Invoices: [
        {
          Type: 'ACCREC',
          Contact: { ContactID: xeroContactId },
          LineItems: lines.map((l) => ({
            Description: l.description,
            Quantity: l.qty,
            UnitAmount: l.unitPrice,
            AccountCode: l.accountCode,
          })),
          Date: isoDate(today),
          DueDate: isoDate(dueDate),
          Status: 'AUTHORISED',
        },
      ],
    }),
  })
  return created.Invoices[0].InvoiceID as string
}
