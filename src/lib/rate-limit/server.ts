// ============================================================
// Postgres-backed rate limiting. SERVER-ONLY.
//
// Wraps the check_rate_limit() SECURITY DEFINER function added in
// supabase/migrations/20260721012_rate_limit_buckets.sql — a
// fixed-window counter table, RLS-enabled with zero policies (same
// default-deny pattern as quickbooks_connections / xero_connections),
// so this admin-client call is the only way in or out.
//
// Fails OPEN: if the rate-limit check itself errors (a DB blip),
// the request is allowed through rather than blocked. A rate
// limiter outage must never be able to take down real traffic —
// that would turn an availability safeguard into an availability
// risk. The failure is still logged via console.warn so it's
// visible (and, once Sentry is wired in, captured there too).
// ============================================================
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Returns true if the caller is still within `maxRequests` for the
 * current fixed window of `windowSeconds`, keyed by `key`. Callers
 * should scope `key` to whatever dimension they want to limit on,
 * e.g. `invite:${organizationId}` or `login:${email}`.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_key: key,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  })

  if (error) {
    console.warn('[rate-limit] check_rate_limit failed, failing open:', error.message)
    return true
  }

  return data as boolean
}
