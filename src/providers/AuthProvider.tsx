'use client'
// ============================================================
// AuthProvider — single source of truth for auth + org state.
// Simplified relative to sibling "-os" projects: fetches the
// user's profile + organization directly via the RLS-scoped
// browser client. Revisit if latency/races show up at scale.
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { UserProfile, Organization } from '@/types'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  organization: Organization | null
  isLoading: boolean
  isAuthenticated: boolean
  isPlatformAdmin: boolean
  isOrgAdmin: boolean
  isClientViewer: boolean
}

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function deriveFlags(profile: UserProfile | null) {
  const role = profile?.role
  return {
    isPlatformAdmin: role === 'platform_admin',
    isOrgAdmin: role === 'platform_admin' || role === 'organization_owner' || role === 'administrator',
    isClientViewer: role === 'client_viewer',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useRef(createClient()).current

  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    organization: null,
    isLoading: true,
    isAuthenticated: false,
    isPlatformAdmin: false,
    isOrgAdmin: false,
    isClientViewer: false,
  })

  const loadProfileAndOrg = useCallback(
    async (user: User) => {
      let { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      // Finishes signup for a user who confirmed their email after
      // /signup already ran: that page couldn't call
      // create_organization_with_owner without a session, so it stashed
      // the org details on user_metadata instead. The first time this
      // now-authenticated user loads any page, run it here.
      if (!profile) {
        const pendingOrgName = user.user_metadata?.pending_org_name
        const pendingOrgSlug = user.user_metadata?.pending_org_slug
        const pendingFullName = user.user_metadata?.pending_full_name
        if (pendingOrgName && pendingOrgSlug && pendingFullName) {
          const { error: orgError } = await supabase.rpc('create_organization_with_owner', {
            p_org_name: pendingOrgName,
            p_org_slug: pendingOrgSlug,
            p_full_name: pendingFullName,
          })
          if (!orgError) {
            await supabase.auth.updateUser({
              data: { pending_org_name: null, pending_org_slug: null, pending_full_name: null },
            })
            const { data: freshProfile } = await supabase
              .from('user_profiles')
              .select('*')
              .eq('auth_user_id', user.id)
              .maybeSingle()
            profile = freshProfile
          }
        }
      }

      let organization: Organization | null = null
      if (profile) {
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .maybeSingle()
        organization = org ?? null
      }

      setState({
        user,
        profile: profile ?? null,
        organization,
        isLoading: false,
        isAuthenticated: true,
        ...deriveFlags(profile ?? null),
      })
    },
    [supabase]
  )

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await loadProfileAndOrg(user)
  }, [supabase, loadProfileAndOrg])

  useEffect(() => {
    let mounted = true

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted) return
      if (user) {
        loadProfileAndOrg(user)
      } else {
        setState((s) => ({ ...s, isLoading: false, isAuthenticated: false }))
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfileAndOrg(session.user)
      } else {
        setState({
          user: null,
          profile: null,
          organization: null,
          isLoading: false,
          isAuthenticated: false,
          isPlatformAdmin: false,
          isOrgAdmin: false,
          isClientViewer: false,
        })
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [supabase, loadProfileAndOrg])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [supabase])

  return (
    <AuthContext.Provider value={{ ...state, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
