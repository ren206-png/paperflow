import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
        PlyCount
      </h1>
      <p className="max-w-xl text-lg text-gray-600">
        Contract pricing, volume tiers, and live margin visibility for tissue and
        paper converters — built so a pulp-cost spike never quietly eats your margin.
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100"
        >
          Start a pilot
        </Link>
      </div>
    </main>
  )
}
