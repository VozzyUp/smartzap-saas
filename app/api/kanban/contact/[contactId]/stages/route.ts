import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getContactStages } from '@/lib/kanban'
import { kanbanErrorResponse } from '../../../_lib'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ contactId: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { contactId } = await params
    const stages = await getContactStages(ctx.tenantId, contactId)
    return NextResponse.json({ stages })
  } catch (error) {
    return kanbanErrorResponse(error, '/contact/[contactId]/stages GET')
  }
}
