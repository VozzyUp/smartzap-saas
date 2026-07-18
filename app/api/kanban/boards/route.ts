import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listBoards, createBoard } from '@/lib/kanban'
import { kanbanErrorResponse } from '../_lib'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const boards = await listBoards(ctx.tenantId)
    return NextResponse.json({ boards })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards GET')
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { name } = body as { name?: string }
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })
    }

    const board = await createBoard(ctx.tenantId, name.trim())
    return NextResponse.json({ board })
  } catch (error) {
    return kanbanErrorResponse(error, '/boards POST')
  }
}
