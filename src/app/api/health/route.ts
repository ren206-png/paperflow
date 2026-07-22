// ============================================================
// GET /api/health — trivial liveness/readiness check. Public (not
// listed as an auth-gated route since it's under /api/, which
// src/middleware.ts already skips entirely for auth redirects).
// Confirms both that the app process is up and that it can reach
// Supabase, so it's useful both as a manual smoke check and as a
// target for external uptime monitoring.
// ============================================================
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').select('id').limit(1)

  if (error) {
    return NextResponse.json(
      { ok: false, database: 'unreachable', error: error.message },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: true, database: 'reachable' })
}
