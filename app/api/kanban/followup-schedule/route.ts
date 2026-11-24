import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { ensureFollowupSweepSchedule } from '@/lib/kanban-automation-schedule'

export const dynamic = 'force-dynamic'

/**
 * POST /api/kanban/followup-schedule
 *
 * Garante (idempotente) o cron horário do follow-up no QStash. Exige usuário logado.
 * A tela de regras de follow-up chama isto ao ativar regras; salvar regras também chama.
 */
export async function POST() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const registered = await ensureFollowupSweepSchedule()
  if (!registered) {
    return NextResponse.json(
      { success: false, error: 'Não foi possível registrar o agendamento (confira QSTASH_TOKEN e a URL do app).' },
      { status: 502 }
    )
  }
  return NextResponse.json({ success: true })
}
