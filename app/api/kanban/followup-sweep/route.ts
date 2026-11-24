import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { Receiver } from '@upstash/qstash'
import { runFollowupSweep } from '@/lib/kanban-automation'

export const dynamic = 'force-dynamic'

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Autorização: assinatura do QStash (Upstash-Signature, chaves QSTASH_CURRENT/NEXT_SIGNING_KEY)
 * OU o segredo compartilhado x-workflow-secret (KANBAN_FOLLOWUP_SWEEP_SECRET).
 * Sem nenhum dos dois configurados/válidos a rota responde 401: nunca fica aberta.
 * (O proxy libera esta rota da sessão/API key porque o QStash não tem nenhuma das duas.)
 */
async function isAuthorized(request: NextRequest, rawBody: string): Promise<boolean> {
  const expectedSecret = process.env.KANBAN_FOLLOWUP_SWEEP_SECRET
  const providedSecret = request.headers.get('x-workflow-secret')
  if (expectedSecret && providedSecret && safeEqual(providedSecret, expectedSecret)) return true

  const signature = request.headers.get('upstash-signature')
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY
  const next = process.env.QSTASH_NEXT_SIGNING_KEY || current
  if (!signature || !current || !next) return false
  try {
    return await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({
      signature,
      body: rawBody,
    })
  } catch {
    return false
  }
}

/**
 * Chamado por um QStash Schedule global (registrado por lib/kanban-automation-schedule.ts),
 * a cada hora, pra todos os tenants. A varredura em lib/kanban-automation.ts escopa por card/tenant.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text().catch(() => '')
  if (!(await isAuthorized(request, rawBody))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
