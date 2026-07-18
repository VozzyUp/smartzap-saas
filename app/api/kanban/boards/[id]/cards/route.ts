import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { addCardToBoard } from '@/lib/kanban'
import { kanbanErrorResponse } from '../../../_lib'

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
    const { contactId, stageId } = body as { contactId?: string; stageId?: string }
    if (!contactId) {
      return NextResponse.json({ error: 'contactId é obrigatório' }, { status: 400 })
    }

    const card = await addCardToBoard(ctx.tenantId, id, contactId, stageId)
    return NextResponse.json({ card })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards/[id]/cards POST')
  }
}
