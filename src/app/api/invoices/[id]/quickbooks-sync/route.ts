// ============================================================
// POST /api/invoices/:id/quickbooks-sync — pushes a PlyCount
// invoice to QuickBooks Online as a QBO Invoice, auto-creating the
// QBO Customer/Item records the first time each is referenced
// (cached afterwards via customers.quickbooks_customer_id /
// products.quickbooks_item_id). Sets invoices.external_ref to the
// resulting QBO Invoice Id on success.
//
// All reads/writes to PlyCount tables go through the cookie-scoped
// server client (respects RLS — a user can only sync invoices in
// their own org). Only the QuickBooks token lookup itself uses the
// admin client, since quickbooks_connections has no client-facing
// RLS policy.
// ============================================================
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import {
  getValidAccessToken,
  findOrCreateQboCustomer,
  findOrCreateQboItem,
  createQboInvoice,
} from '@/lib/quickbooks/server'

export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single()
  if (invoiceError || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  if (invoice.external_ref) {
    return NextResponse.json({ error: 'This invoice is already synced to QuickBooks.' }, { status: 400 })
  }

  const tokenInfo = await getValidAccessToken(invoice.organization_id)
  if (!tokenInfo) {
    return NextResponse.json(
      { error: 'QuickBooks is not connected for this organization yet — connect it in Settings.' },
      { status: 501 }
    )
  }
  const { accessToken, realmId } = tokenInfo

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, customer_id')
    .eq('id', invoice.order_id)
    .single()
  if (orderError || !order) {
    return NextResponse.json({ error: 'Order for this invoice not found.' }, { status: 404 })
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, name, quickbooks_customer_id')
    .eq('id', order.customer_id)
    .single()
  if (customerError || !customer) {
    return NextResponse.json({ error: 'Customer for this order not found.' }, { status: 404 })
  }

  const { data: invoiceLines, error: linesError } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', invoice.id)
  if (linesError || !invoiceLines || invoiceLines.length === 0) {
    return NextResponse.json({ error: 'This invoice has no lines.' }, { status: 400 })
  }

  const orderLineIds = Array.from(new Set(invoiceLines.map((l) => l.order_line_id)))
  const { data: orderLines, error: orderLinesError } = await supabase
    .from('order_lines')
    .select('id, product_id')
    .in('id', orderLineIds)
  if (orderLinesError || !orderLines) {
    return NextResponse.json({ error: 'Could not load order lines.' }, { status: 500 })
  }

  const productIds = Array.from(new Set(orderLines.map((l) => l.product_id)))
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, sku_code, quickbooks_item_id')
    .in('id', productIds)
  if (productsError || !products) {
    return NextResponse.json({ error: 'Could not load products.' }, { status: 500 })
  }

  try {
    // Resolve (or create) the QBO customer, caching the mapping.
    let qboCustomerId = customer.quickbooks_customer_id
    if (!qboCustomerId) {
      qboCustomerId = await findOrCreateQboCustomer(realmId, accessToken, customer.name)
      await supabase.from('customers').update({ quickbooks_customer_id: qboCustomerId }).eq('id', customer.id)
    }

    // Resolve (or create) a QBO item per distinct product, caching each mapping.
    const itemIdByProductId = new Map<string, string>()
    for (const product of products) {
      if (product.quickbooks_item_id) {
        itemIdByProductId.set(product.id, product.quickbooks_item_id)
        continue
      }
      const itemId = await findOrCreateQboItem(realmId, accessToken, product.sku_code)
      await supabase.from('products').update({ quickbooks_item_id: itemId }).eq('id', product.id)
      itemIdByProductId.set(product.id, itemId)
    }

    const productById = new Map(products.map((p) => [p.id, p]))
    const orderLineById = new Map(orderLines.map((l) => [l.id, l]))

    const qboLines = invoiceLines.map((line) => {
      const orderLine = orderLineById.get(line.order_line_id)
      const product = orderLine ? productById.get(orderLine.product_id) : undefined
      const itemId = orderLine ? itemIdByProductId.get(orderLine.product_id) : undefined
      if (!itemId || !product) {
        throw new Error(`Could not resolve a QuickBooks item for order line ${line.order_line_id}.`)
      }
      return {
        itemId,
        description: `${product.sku_code} — ${product.name}`,
        qty: line.qty_invoiced,
        unitPrice: line.unit_price,
      }
    })

    const qboInvoiceId = await createQboInvoice(realmId, accessToken, qboCustomerId, qboLines)

    const { error: updateError } = await supabase
      .from('invoices')
      .update({ external_ref: qboInvoiceId, status: invoice.status === 'draft' ? 'sent' : invoice.status })
      .eq('id', invoice.id)

    if (updateError) {
      return NextResponse.json(
        { error: `Synced to QuickBooks (Invoice ${qboInvoiceId}) but failed to save the reference: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, externalRef: qboInvoiceId })
  } catch (err) {
    Sentry.captureException(err, { tags: { integration: 'quickbooks', invoiceId: invoice.id } })
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
