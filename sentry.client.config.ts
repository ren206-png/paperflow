// ============================================================
// Sentry init for the browser. Runs on every page load.
//
// Guarded on NEXT_PUBLIC_SENTRY_DSN so that leaving it unset (the
// default — see .env.local.example) is a true no-op: Sentry.init()
// is simply never called, and the app behaves exactly as it did
// before Sentry was added. No crash, no behavior change, nothing
// to configure to keep working locally.
// ============================================================
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    // Session replay is a paid-tier feature and not something this
    // project has opted into — leave off rather than silently
    // sampling replays nobody's looking at.
  })
}
