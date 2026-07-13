/**
 * Auth status helper for the dashboard.
 *
 * Combina "empresa configurada" (settings no banco, ver `lib/user-auth.ts`)
 * com "usuário autenticado" (sessão Supabase, ver `lib/tenant-context.ts`).
 * Login de usuário é via Supabase Auth (magic link) — não há mais
 * MASTER_PASSWORD como caminho de autenticação de usuário.
 */

import { getCompany, isSetupComplete, type Company } from './user-auth'
import { getTenantContext } from './tenant-context'

export interface UserAuthStatus {
  isConfigured: boolean
  isSetup: boolean
  isAuthenticated: boolean
  company: Company | null
}

function isSupabaseConfiguredForAuth(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY)
  )
}

export async function getUserAuthStatus(): Promise<UserAuthStatus> {
  const isConfigured = isSupabaseConfiguredForAuth()

  if (!isConfigured) {
    return { isConfigured: false, isSetup: false, isAuthenticated: false, company: null }
  }

  const [isSetup, tenantContext] = await Promise.all([
    isSetupComplete(),
    getTenantContext(),
  ])

  const isAuthenticated = !!tenantContext
  const company = isAuthenticated ? await getCompany() : null

  return { isConfigured: true, isSetup, isAuthenticated, company }
}
