import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { createStage } from '@/lib/kanban'
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
    const { name, color } = body as { name?: string; color?: string }
    if (!name || !name.trim() || !color || !color.trim()) {
      return NextResponse.json({ error: 'name e color são obrigatórios' }, { status: 400 })
    }

    const stage = await createStage(ctx.tenantId, id, { name: name.trim(), color: color.trim() })
    return NextResponse.json({ stage })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards/[id]/stages POST')
  }
}
