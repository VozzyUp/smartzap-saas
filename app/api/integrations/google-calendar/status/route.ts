import { NextResponse } from 'next/server'
import { getCalendarChannel, getCalendarConfig, getStoredTokens } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'
import { getTenantContext } from '@/lib/tenant-context'

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ connected: false, error: 'Supabase não configurado' }, { status: 400 })
    }

    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ connected: false, error: 'unauthorized' }, { status: 401 })
    const tenantId = ctx.tenantId

    const [tokens, config, channel] = await Promise.all([
      getStoredTokens(tenantId),
      getCalendarConfig(tenantId),
      getCalendarChannel(tenantId),
    ])

    const connected = !!tokens?.accessToken

    return NextResponse.json({
      connected,
      calendar: config,
      channel,
      hasRefreshToken: Boolean(tokens?.refreshToken),
      expiresAt: tokens?.expiryDate || null,
    })
  } catch (error) {
    console.error('[google-calendar] status error:', error)
    return NextResponse.json({ connected: false, error: 'Falha ao consultar status' }, { status: 500 })
  }
}
