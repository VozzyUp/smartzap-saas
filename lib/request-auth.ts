import type { NextRequest } from 'next/server'
import { type AuthResult, unauthorizedResponse, verifyApiKey } from '@/lib/auth'
import { getTenantContext } from '@/lib/tenant-context'

/**
 * Require either:
 * - a valid Supabase session (browser cookies, via @supabase/ssr), OR
 * - a valid API key (Authorization: Bearer ... / X-API-Key)
 *
 * Security goal: defense-in-depth for critical endpoints (PII, destructive actions),
 * even if Proxy rules change or a route is accidentally exposed.
 */
export async function requireSessionOrApiKey(request: NextRequest) {
  const hasApiKeyHeader =
    !!request.headers.get('authorization') || !!request.headers.get('x-api-key')

  if (hasApiKeyHeader) {
    const auth: AuthResult = await verifyApiKey(request)
    if (!auth.valid) return unauthorizedResponse(auth.error)
    return null
  }

  // Fall back to session-based access for browser UI.
  const ctx = await getTenantContext()
  if (!ctx) return unauthorizedResponse('Missing session or API key')
  return null
}

