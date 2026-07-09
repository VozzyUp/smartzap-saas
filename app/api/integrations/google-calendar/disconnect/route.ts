import { NextResponse } from 'next/server'
import { clearCalendarIntegration, getStoredTokens, revokeGoogleToken } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'
import { getTenantContext } from '@/lib/tenant-context'

export async function POST() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'Supabase nao configurado' }, { status: 400 })
    }

    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    const tenantId = ctx.tenantId

    const tokens = await getStoredTokens(tenantId)
    if (tokens?.accessToken) {
      await revokeGoogleToken(tokens.accessToken)
    }
    if (tokens?.refreshToken) {
      await revokeGoogleToken(tokens.refreshToken)
    }

    await clearCalendarIntegration(tenantId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[google-calendar] disconnect error:', error)
    return NextResponse.json({ ok: false, error: 'Falha ao desconectar' }, { status: 500 })
  }
}
