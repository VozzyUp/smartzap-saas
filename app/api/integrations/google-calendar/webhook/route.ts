import { NextRequest, NextResponse } from 'next/server'
import { getCalendarChannel, markCalendarNotification, resolveTenantByChannelToken } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'Supabase nao configurado' }, { status: 400 })
    }

    const channelToken = request.headers.get('x-goog-channel-token')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channelToken) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const tenantId = await resolveTenantByChannelToken(channelToken)
    if (!tenantId) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const channel = await getCalendarChannel(tenantId)
    if (!channel || channelToken !== channel.token) {
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
