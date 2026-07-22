'use client'

// ============================================================
// Route-segment error boundary (Next 14 App Router convention —
// catches errors thrown while rendering src/app/** below this
// level, outside of the root layout itself). Reports to Sentry
// (a no-op if NEXT_PUBLIC_SENTRY_DSN isn't set) and offers a retry
// via Next's `reset()`, which re-renders the segment.
// ============================================================
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/Button'

export default function Error({
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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-gray-900">Something went wrong.</h2>
      <p className="max-w-md text-sm text-gray-600">
        An unexpected error occurred. It&apos;s been reported — try again, or reload the page.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  )
}
