import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { updateStage, deleteStage } from '@/lib/kanban'
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
    const { name, color } = body as { name?: string; color?: string }
    if (name === undefined && color === undefined) {
      return NextResponse.json({ error: 'name ou color é obrigatório' }, { status: 400 })
    }

    await updateStage(ctx.tenantId, id, { name, color })
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/stages/[id] PATCH')
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    await deleteStage(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/stages/[id] DELETE')
  }
}
