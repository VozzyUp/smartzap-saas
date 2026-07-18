import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { reorderStages } from '@/lib/kanban'
import { kanbanErrorResponse } from '../../../../_lib'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { orderedIds } = body as { orderedIds?: string[] }
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: 'orderedIds é obrigatório' }, { status: 400 })
    }

    await reorderStages(ctx.tenantId, id, orderedIds)
    return NextResponse.json({ success: true })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards/[id]/stages/reorder POST')
  }
}
