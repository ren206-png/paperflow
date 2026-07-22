// ============================================================
// Shared "is this role an org admin" check, mirroring the SQL
// is_org_admin() function (see 20260704001_organizations.sql)
// and the client-side deriveFlags() in AuthProvider. Needed
// server-side for routes that write to tables with no RLS policy
// at all (e.g. quickbooks_connections) and so must authorize the
// caller in application code instead of relying on the database.
// ============================================================
import type { UserRole } from '@/types'

const ADMIN_ROLES: UserRole[] = ['platform_admin', 'organization_owner', 'administrator']

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role)
}
