'use client'

// ============================================================
// Root-level error boundary (Next 14 App Router convention) —
// catches errors thrown by the root layout itself, which src/app/
// error.tsx cannot catch (it only covers segments rendered *inside*
// the root layout). Must render its own <html>/<body> since it
// replaces the root layout entirely when it fires. Reports to
// Sentry the same way error.tsx does.
// ============================================================
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
            fontFamily: 'sans-serif',
          }}
        >
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Something went wrong.</h2>
          <p style={{ maxWidth: '28rem', fontSize: '0.875rem', color: '#4b5563' }}>
            An unexpected error occurred. It&apos;s been reported — try again, or reload the page.
          </p>
          <button
            onClick={() => reset()}
            style={{
              borderRadius: '0.375rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#4f46e5',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
