// ============================================================
// Pure logic for Margin Guard — pulled out of the page component
// (same pattern as rollup.ts) so both the Margin Alerts worklist
// and the dashboard overview banner compute the exact same set of
// "active" alerts, and so this can be unit tested without mounting
// React or hitting Supabase.
// ============================================================
import type { MarginAlertReview, PriceBookLineMargin } from '@/types'

// Same red-flag threshold already used everywhere margin is displayed
// (quotes, orders, margin dashboard) — Margin Guard just turns that
// reactive display into a proactive worklist.
export const ALERT_THRESHOLD_PCT = 15

// A line is an active alert when its margin is below threshold AND it
// hasn't already been reviewed against this exact cost snapshot. If the
// cost changes again after a dismissal/reprice, reviewed_cost_effective_date
// is stale relative to the new cost_effective_date, so it correctly
// reappears instead of being silenced forever.
export function activeMarginAlerts(
  lines: PriceBookLineMargin[],
  reviews: MarginAlertReview[]
): PriceBookLineMargin[] {
  const latestReviewByLine = new Map<string, MarginAlertReview>()
  for (const r of reviews) {
    if (!latestReviewByLine.has(r.price_book_line_id)) latestReviewByLine.set(r.price_book_line_id, r)
  }

  return lines
    .filter((l) => l.margin_pct !== null && l.margin_pct < ALERT_THRESHOLD_PCT)
    .filter((l) => {
      const review = latestReviewByLine.get(l.price_book_line_id)
      if (!review) return true
      if (!l.cost_effective_date) return true
      return review.reviewed_cost_effective_date < l.cost_effective_date
    })
    .sort((a, b) => (a.margin_pct ?? 0) - (b.margin_pct ?? 0))
}

// Price that hits `targetMarginPct` given a unit cost. Used only to
// *suggest* a reprice — a human always clicks Apply before it's written.
export function suggestedRepriceUnitPrice(cost: number, targetMarginPct: number): number {
  if (!Number.isFinite(targetMarginPct) || targetMarginPct >= 100) return cost
  return Math.round((cost / (1 - targetMarginPct / 100)) * 100) / 100
}
