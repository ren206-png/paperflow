// ============================================================
// Sentry init for the Edge runtime — specifically src/middleware.ts,
// which has no explicit `runtime` export and so runs on Edge by
// default (confirmed by reading the file: broad matcher, no Node
// APIs). Kept as its own file because the Edge runtime doesn't
// support everything the Node SDK config does. Same no-op-when-
// unset guard as the other two config files.
// ============================================================
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  })
}
