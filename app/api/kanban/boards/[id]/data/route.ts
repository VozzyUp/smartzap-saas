import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getBoardData } from '@/lib/kanban'
import { kanbanErrorResponse } from '../../../_lib'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    const data = await getBoardData(ctx.tenantId, id)
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json(data)
  } catch (error) {
    return kanbanErrorResponse(error, '/boards/[id]/data GET')
  }
}
