// ============================================================
// Sentry init for the Node.js server runtime (everything under
// src/app/api/** and src/app/**/page.tsx server components that
// don't set `export const runtime = 'edge'` — none currently do).
// Same no-op-when-unset guard as sentry.client.config.ts.
// ============================================================
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  })
}
