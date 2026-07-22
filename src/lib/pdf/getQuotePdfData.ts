// ============================================================
// Shared server-side loader for the quote PDF — used by both the
// download route and the send route so they can't drift on what
// data ends up on the customer-facing document.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QuotePdfData } from './QuoteDocument'

export async function getQuotePdfData(
  supabase: SupabaseClient,
  quoteId: string
): Promise<{ data: QuotePdfData; customerEmail: string | null } | { error: string }> {
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .single()
  if (quoteError || !quote) return { error: 'Quote not found.' }

  const { data: lines, error: linesError } = await supabase
    .from('quote_lines')
    .select('*')
    .eq('quote_id', quoteId)
    .order('created_at')
  if (linesError) return { error: linesError.message }
  if (!lines || lines.length === 0) return { error: 'Quote has no line items.' }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .eq('id', quote.customer_id)
    .single()
  if (customerError || !customer) return { error: 'Customer not found.' }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', quote.organization_id)
    .single()
  if (orgError || !org) return { error: 'Organization not found.' }

  const productIds = Array.from(new Set(lines.map((l) => l.product_id)))
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*')
    .in('id', productIds)
  if (productsError) return { error: productsError.message }

  const productFor = (id: string) => products?.find((p) => p.id === id)

  const total = lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0)

  return {
    data: {
      organizationName: org.name,
      quoteId: quote.id,
      createdAt: quote.created_at,
      expiresAt: quote.expires_at,
      customerName: customer.name,
      customerContactName: customer.contact_name,
      total,
      lines: lines.map((l) => {
        const product = productFor(l.product_id)
        return {
          skuCode: product?.sku_code ?? l.product_id,
          productName: product?.name ?? '—',
          qty: l.qty,
          unitPrice: l.unit_price,
          unitOfMeasure: product?.unit_of_measure ?? 'each',
        }
      }),
    },
    customerEmail: customer.contact_email,
  }
}
