// ============================================================
// POST /api/quotes/:id/send — renders the quote PDF, emails it to
// the customer's contact_email via Resend, and flips the quote's
// status to 'sent'. All reads/writes go through the cookie-scoped
// server client so this respects the same RLS as the rest of the
// app — a user can only send quotes belonging to their own org.
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { getQuotePdfData } from '@/lib/pdf/getQuotePdfData'
import { renderQuotePdfBuffer } from '@/lib/pdf/renderQuotePdf'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: 'Email delivery is not configured yet (RESEND_API_KEY missing). Download the PDF and send it manually for now.' },
      { status: 501 }
    )
  }

  const supabase = await createClient()
  const result = await getQuotePdfData(supabase, params.id)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 })
  }

  if (!result.customerEmail) {
    return NextResponse.json(
      { error: 'This customer has no contact email on file — add one before sending.' },
      { status: 400 }
    )
  }

  const buffer = await renderQuotePdfBuffer(result.data)
  const resend = new Resend(process.env.RESEND_API_KEY)

  const fromAddress = process.env.RESEND_FROM_EMAIL || 'quotes@plycount.app'

  const { error: sendError } = await resend.emails.send({
    from: `${result.data.organizationName} <${fromAddress}>`,
    to: result.customerEmail,
    subject: `Quote from ${result.data.organizationName}`,
    text: `Hi${result.data.customerContactName ? ` ${result.data.customerContactName}` : ''},\n\nPlease find your quote from ${result.data.organizationName} attached.\n\nTotal: $${result.data.total.toFixed(2)}${result.data.expiresAt ? `\nValid until: ${new Date(result.data.expiresAt).toLocaleDateString()}` : ''}`,
    attachments: [
      {
        filename: `quote-${result.data.quoteId.slice(0, 8)}.pdf`,
        content: buffer,
      },
    ],
  })

  if (sendError) {
    return NextResponse.json({ error: sendError.message }, { status: 502 })
  }

  const { error: statusError } = await supabase
    .from('quotes')
    .update({ status: 'sent' })
    .eq('id', params.id)

  if (statusError) {
    return NextResponse.json(
      { error: `Email sent, but failed to update quote status: ${statusError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
