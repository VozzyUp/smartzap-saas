import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { moveCard, removeCard } from '@/lib/kanban'
import { kanbanErrorResponse } from '../../_lib'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { stageId, position } = body as { stageId?: string; position?: number }
    if (!stageId || typeof position !== 'number') {
      return NextResponse.json({ error: 'stageId e position são obrigatórios' }, { status: 400 })
    }

    await moveCard(ctx.tenantId, id, { stageId, position })
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/cards/[id] PATCH')
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    await removeCard(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/cards/[id] DELETE')
  }
}
