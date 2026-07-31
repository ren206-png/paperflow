import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

// Sentry's build-time wrapper (source map upload, etc.) only does
// anything useful once a DSN is actually configured — with no DSN,
// sentry.*.config.ts never call Sentry.init() anyway, so skip the
// wrapper entirely rather than adding build-time behavior (and a
// noisy "no org/project configured" warning) for a feature that's
// off. SENTRY_AUTH_TOKEN is optional even when the DSN is set: it
// only gates source map upload for readable stack traces, not error
// capture itself.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disableLogger: true,
      widenClientFileUpload: false,
    })
  : nextConfig
