import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { renameBoard, deleteBoard } from '@/lib/kanban'
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
    const { name } = body as { name?: string }
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })
    }

    await renameBoard(ctx.tenantId, id, name.trim())
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards/[id] PATCH')
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    await deleteBoard(ctx.tenantId, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards/[id] DELETE')
  }
}
