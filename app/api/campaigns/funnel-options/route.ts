import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listBoards, listStages } from '@/lib/kanban'

export const dynamic = 'force-dynamic'

/** GET -> quadros de funil da conta com suas fases (para "Ao enviar, colocar o contato na fase"). */
export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const boards = await listBoards(ctx.tenantId)
    const withStages = await Promise.all(
      boards.map(async (b) => ({
        id: b.id,
        name: b.name,
        stages: (await listStages(ctx.tenantId, b.id)).map((s) => ({ id: s.id, name: s.name })),
      }))
    )
    return NextResponse.json({ boards: withStages.filter((b) => b.stages.length > 0) })
  } catch (error) {
    console.error('[campaigns/funnel-options] falha:', error)
    return NextResponse.json({ boards: [] })
  }
}
