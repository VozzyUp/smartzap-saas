import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listFollowupRules, saveFollowupRules } from '@/lib/kanban-automation'
import { normalizeFollowupTemplate } from '@/lib/kanban-followup-config'
import { ensureFollowupSweepSchedule } from '@/lib/kanban-automation-schedule'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const rules = await listFollowupRules(ctx.tenantId, id)
  return NextResponse.json({ rules })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const rules = (Array.isArray(body?.rules) ? body.rules : []).map((r: any) => ({
    ...r,
    template: normalizeFollowupTemplate(r?.template),
  }))
  await saveFollowupRules(ctx.tenantId, id, rules)
  // Ativar regras = garantir o cron horário do sweep (idempotente, best-effort).
  const scheduled = rules.length > 0 ? await ensureFollowupSweepSchedule() : true
  return NextResponse.json({ success: true, scheduled })
}
