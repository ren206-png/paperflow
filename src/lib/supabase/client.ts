// ============================================================
// Supabase Browser Client
// Used in Client Components. Types are hand-rolled in
// src/types/index.ts rather than generated — fine at MVP scale,
// revisit once `supabase gen types` is worth wiring up.
// ============================================================
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
