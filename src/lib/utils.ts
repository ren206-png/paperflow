import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

// Guards `[id]` dynamic routes against literal path segments that aren't
// actual UUIDs (e.g. a stray/renamed "new" folder, a bad bookmark, or a
// bot probing routes). Without this, `.eq('id', params.id)` against a uuid
// column throws a Postgres 400 (invalid input syntax for type uuid) that
// react-query treats as an error state indistinguishable from "still
// loading", leaving the page stuck on "Loading…" forever instead of
// showing a clear "not found" message.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUUID(value: string): boolean {
  return UUID_RE.test(value)
}
