'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    + '-' + Math.random().toString(36).slice(2, 6)
}

export default function SignupPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    const supabase = createClient()

    // The org name/slug/full name are stashed as auth user metadata so
    // they survive the email-confirmation round trip: if this Supabase
    // project requires confirming email before a session exists (the
    // common case), signUp() below returns no session, and the org can't
    // be created yet — AuthProvider finishes the job the first time this
    // user actually authenticates (see loadProfileAndOrg's pending-org
    // fallback), reading these same fields back off user_metadata.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          pending_org_name: orgName,
          pending_org_slug: slugify(orgName),
          pending_full_name: fullName,
        },
      },
    })

    if (signUpError || !signUpData.user) {
      toast.error(signUpError?.message ?? 'Sign up failed')
      setIsSubmitting(false)
      return
    }

    if (!signUpData.session) {
      // Confirmation required — no session yet, so the org can't be
      // created here. It'll be created automatically on first login
      // once the user confirms their email (see AuthProvider).
      setIsSubmitting(false)
      toast.success('Account created — check your email to confirm it, then sign in to finish setup.')
      router.push('/login')
      return
    }

    const { error: orgError } = await supabase.rpc('create_organization_with_owner', {
      p_org_name: orgName,
      p_org_slug: slugify(orgName),
      p_full_name: fullName,
    })

    setIsSubmitting(false)

    if (orgError) {
      toast.error(`Account created, but organization setup failed: ${orgError.message}`)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Start your pilot</h1>
      <p className="mb-6 text-sm text-gray-600">
        Set up your company and the first admin account.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Company name</label>
          <input
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Your full name</label>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  )
}
