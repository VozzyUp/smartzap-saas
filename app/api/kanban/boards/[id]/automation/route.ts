import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getBoardAutomationConfig, saveBoardAutomationConfig } from '@/lib/kanban-automation'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const config = await getBoardAutomationConfig(ctx.tenantId, id)
  return NextResponse.json(config)
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  await saveBoardAutomationConfig(ctx.tenantId, id, body)
  return NextResponse.json({ success: true })
}
