import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/supabase'
import { getCalendar, getCalendarConfig, saveCalendarConfig, ensureCalendarChannel } from '@/lib/google-calendar'
import { getTenantContext } from '@/lib/tenant-context'

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase nao configurado' }, { status: 400 })
    }

    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const tenantId = ctx.tenantId

    const body = await request.json().catch(() => ({}))
    const calendarId = String(body?.calendarId || '').trim()
    if (!calendarId) {
      return NextResponse.json({ error: 'calendarId ausente' }, { status: 400 })
    }

    const details = await getCalendar(tenantId, calendarId)
    const existing = await getCalendarConfig(tenantId)
    const config = {
      calendarId,
      calendarSummary: details?.summary ? String(details.summary) : null,
      calendarTimeZone: details?.timeZone ? String(details.timeZone) : null,
      connectedAt: new Date().toISOString(),
      accountEmail: existing?.accountEmail || null,
    }

    await saveCalendarConfig(tenantId, config)
    await ensureCalendarChannel(tenantId, calendarId)

    return NextResponse.json({ ok: true, config })
  } catch (error) {
    console.error('[google-calendar] config error:', error)
    return NextResponse.json({ error: 'Falha ao salvar calendario' }, { status: 500 })
  }
}
