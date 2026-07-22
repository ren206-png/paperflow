// ============================================================
// Customer-facing quote PDF. Deliberately excludes unit_cost_snapshot
// and margin_pct — those are internal-only fields on quote_lines.
// Rendered server-side only (Node runtime), never in the browser.
// ============================================================
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

export interface QuotePdfLine {
  skuCode: string
  productName: string
  qty: number
  unitPrice: number
  unitOfMeasure: string
}

export interface QuotePdfData {
  organizationName: string
  quoteId: string
  createdAt: string
  expiresAt: string | null
  customerName: string
  customerContactName: string | null
  lines: QuotePdfLine[]
  total: number
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1f2937' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  orgName: { fontSize: 18, fontWeight: 700 },
  quoteMeta: { textAlign: 'right', color: '#6b7280' },
  section: { marginBottom: 16 },
  label: { color: '#6b7280', fontSize: 9, textTransform: 'uppercase', marginBottom: 2 },
  value: { fontSize: 11 },
  table: { marginTop: 12, borderTop: '1 solid #e5e7eb' },
  tableRow: { flexDirection: 'row', borderBottom: '1 solid #e5e7eb', paddingVertical: 6 },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottom: '1 solid #1f2937',
    paddingVertical: 6,
    fontWeight: 700,
  },
  colSku: { width: '20%' },
  colName: { width: '35%' },
  colQty: { width: '15%', textAlign: 'right' },
  colPrice: { width: '15%', textAlign: 'right' },
  colTotal: { width: '15%', textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, paddingTop: 8 },
  totalLabel: { fontWeight: 700, marginRight: 24 },
  totalValue: { fontWeight: 700 },
  footer: { marginTop: 40, fontSize: 8, color: '#9ca3af' },
})

function money(n: number) {
  return `$${n.toFixed(2)}`
}

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.orgName}>{data.organizationName}</Text>
          <View style={styles.quoteMeta}>
            <Text>Quote #{data.quoteId.slice(0, 8).toUpperCase()}</Text>
            <Text>Date: {new Date(data.createdAt).toLocaleDateString()}</Text>
            {data.expiresAt && <Text>Valid until: {new Date(data.expiresAt).toLocaleDateString()}</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Prepared for</Text>
          <Text style={styles.value}>{data.customerName}</Text>
          {data.customerContactName && <Text style={styles.value}>{data.customerContactName}</Text>}
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colSku}>SKU</Text>
            <Text style={styles.colName}>Product</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colPrice}>Unit price</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {data.lines.map((l, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colSku}>{l.skuCode}</Text>
              <Text style={styles.colName}>{l.productName}</Text>
              <Text style={styles.colQty}>{l.qty} {l.unitOfMeasure}</Text>
              <Text style={styles.colPrice}>{money(l.unitPrice)}</Text>
              <Text style={styles.colTotal}>{money(l.qty * l.unitPrice)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{money(data.total)}</Text>
        </View>

        <Text style={styles.footer}>
          This quote is provided by {data.organizationName}
          {data.expiresAt ? ` and is valid through ${new Date(data.expiresAt).toLocaleDateString()}.` : '.'} Prices
          subject to confirmation at time of order.
        </Text>
      </Page>
    </Document>
  )
}
