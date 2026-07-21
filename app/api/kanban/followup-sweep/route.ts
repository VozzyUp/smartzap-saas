import { NextRequest, NextResponse } from 'next/server'
import { runFollowupSweep } from '@/lib/kanban-automation'

export const dynamic = 'force-dynamic'

/**
 * Chamado por um QStash Schedule global (registrado uma vez no deploy — ver
 * lib/kanban-automation-schedule.ts), a cada hora, pra todos os tenants. Não
 * é uma rota por-tenant: a varredura em lib/kanban-automation.ts já escopa
 * por card/tenant internamente.
 */
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.KANBAN_FOLLOWUP_SWEEP_SECRET
  if (expectedSecret) {
    const provided = request.headers.get('x-workflow-secret')
    if (provided !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    await runFollowupSweep()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Kanban] Falha no sweep de follow-up:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    )
  }
}
