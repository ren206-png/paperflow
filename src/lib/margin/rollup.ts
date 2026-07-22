// ============================================================
// Pure aggregation helper for the Margin Dashboard — pulled out of
// the page component so it can be unit tested without mounting
// React or hitting Supabase.
// ============================================================
export interface RollupInput {
  label: string
  revenue: number
  cost: number
}

export interface RollupBucket {
  key: string
  label: string
  revenue: number
  cost: number
}

export function rollUp(rows: RollupInput[]): RollupBucket[] {
  const map = new Map<string, RollupBucket>()
  for (const row of rows) {
    const existing = map.get(row.label)
    if (existing) {
      existing.revenue += row.revenue
      existing.cost += row.cost
    } else {
      map.set(row.label, { key: row.label, label: row.label, revenue: row.revenue, cost: row.cost })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
}
