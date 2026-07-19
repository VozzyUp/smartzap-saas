import { NextRequest, NextResponse } from 'next/server'
import { createEvent, getCalendarConfig } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'
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
    const calendarId = String(body?.calendarId || '') || (await getCalendarConfig(tenantId))?.calendarId
    if (!calendarId) {
      return NextResponse.json({ error: 'calendarId ausente' }, { status: 400 })
    }

    const start = String(body?.start || '')
    const end = String(body?.end || '')
    const timeZone = body?.timeZone ? String(body.timeZone) : undefined

    if (!start || !end) {
      return NextResponse.json({ error: 'start e end sao obrigatorios' }, { status: 400 })
    }

    const summary = body?.summary ? String(body.summary) : 'Agendamento via V-Smart'
    const description = body?.description ? String(body.description) : undefined
    const attendees = Array.isArray(body?.attendees) ? body.attendees : undefined

    const extendedProperties = body?.extendedProperties && typeof body.extendedProperties === 'object'
      ? body.extendedProperties
      : undefined

    const event = {
      summary,
      description,
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
      attendees,
      extendedProperties,
    }

    const created = await createEvent(tenantId, { calendarId, event })

    return NextResponse.json({
      id: created?.id || null,
      htmlLink: created?.htmlLink || null,
      status: created?.status || null,
    })
  } catch (error) {
    console.error('[google-calendar] create event error:', error)
    return NextResponse.json({ error: 'Falha ao criar evento' }, { status: 500 })
  }
}
