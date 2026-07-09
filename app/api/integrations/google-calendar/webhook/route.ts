import { NextRequest, NextResponse } from 'next/server'
import { getCalendarChannel, markCalendarNotification } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'
import { resolveWebhookTenantId } from '@/lib/tenant-context'

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'Supabase nao configurado' }, { status: 400 })
    }

    // Push notification do Google Calendar: não há sessão nem forma indexada de
    // mapear o x-goog-channel-token para um tenant (settings é key/value por
    // tenant, sem índice reverso por token). Guard intencional até Fase 2B
    // (schema dedicado de canais com tenant_id + lookup por token).
    const tenantId = await resolveWebhookTenantId()

    const channel = await getCalendarChannel(tenantId)
    const channelToken = request.headers.get('x-goog-channel-token')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channel || !channelToken || channelToken !== channel.token) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    await markCalendarNotification(tenantId, { resourceState })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[google-calendar] webhook error:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
