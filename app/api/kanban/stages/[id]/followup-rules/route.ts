import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listFollowupRules, saveFollowupRules } from '@/lib/kanban-automation'

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
  const rules = Array.isArray(body?.rules) ? body.rules : []
  await saveFollowupRules(ctx.tenantId, id, rules)
  return NextResponse.json({ success: true })
}
