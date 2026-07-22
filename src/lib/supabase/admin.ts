// ============================================================
// Supabase Admin Client (service role — bypasses RLS)
// SERVER-ONLY. Never import this from a Client Component or
// expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// Used for: platform-admin tooling, Stripe webhook handlers,
// and background jobs that must act across tenants.
// ============================================================
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
