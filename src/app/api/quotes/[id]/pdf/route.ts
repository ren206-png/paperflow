// ============================================================
// GET /api/quotes/:id/pdf — streams the customer-facing quote PDF.
// Uses the cookie-scoped server client, so this is gated by the
// same RLS policy as everything else (only members of the quote's
// organization, or a platform admin, can fetch it).
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getQuotePdfData } from '@/lib/pdf/getQuotePdfData'
import { renderQuotePdfBuffer } from '@/lib/pdf/renderQuotePdf'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const result = await getQuotePdfData(supabase, id)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 })
  }

  const buffer = await renderQuotePdfBuffer(result.data)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="quote-${result.data.quoteId.slice(0, 8)}.pdf"`,
    },
  })
}
