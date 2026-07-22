'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/providers/AuthProvider'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/quotes', label: 'Quotes' },
  { href: '/portal/orders', label: 'Orders' },
  { href: '/portal/invoices', label: 'Invoices' },
]

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { profile, organization, signOut, isLoading, isClientViewer } = useAuth()

  useEffect(() => {
    // Staff shouldn't land in the portal — send them to the real dashboard.
    if (!isLoading && !isClientViewer) {
      router.replace('/dashboard')
    }
  }, [isLoading, isClientViewer, router])

  if (isLoading || !isClientViewer) return null

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <p className="text-lg font-bold text-brand-700">{organization?.name ?? 'PaperFlow'}</p>
          <p className="text-xs text-gray-500">Customer portal</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm font-medium',
                  active ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-gray-200 px-5 py-4">
          <p className="truncate text-sm font-medium text-gray-900">{profile?.full_name}</p>
          <button onClick={() => signOut()} className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-800">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-gray-50 p-8">{children}</main>
    </div>
  )
}
