import { NextResponse } from 'next/server'
import { Client as QStashClient } from '@upstash/qstash'
import { supabase } from '@/lib/supabase'
import { campaignDb } from '@/lib/supabase-db'
import { CampaignStatus } from '@/types'
import { getTenantContext } from '@/lib/tenant-context'

// Registry in-memory (dev-only) for localhost scheduling.
// QStash cannot reach localhost, então usamos um setTimeout em dev.
const localScheduleRegistry: Map<string, NodeJS.Timeout> =
  (globalThis as any).__smartzapLocalScheduleRegistry
  || ((globalThis as any).__smartzapLocalScheduleRegistry = new Map<string, NodeJS.Timeout>())

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * POST /api/campaigns/[id]/cancel-schedule
 * Cancela o agendamento (one-shot) no QStash e volta a campanha para Rascunho.
 *
 * Regras:
 * - Só faz sentido para campanhas em status SCHEDULED.
 * - É idempotente: se não houver messageId, apenas limpa o scheduledAt.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params

    const { data: row, error } = await supabase
      .from('campaigns')
      .select('id, status, scheduled_date, qstash_schedule_message_id')
      .eq('id', id)
      .single()

    if (error || !row) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }

    // Prevent cancel after start
    if (row.status !== CampaignStatus.SCHEDULED) {
      return NextResponse.json(
        { error: 'Só é possível cancelar campanhas agendadas', status: row.status },
        { status: 409 }
      )
    }

    const messageId = (row as any).qstash_schedule_message_id as string | null

    // Also cancel local in-process schedule (dev-only) if present.
    if (process.env.NODE_ENV === 'development' && row.scheduled_date) {
      try {
        const scheduledAtIso = new Date(row.scheduled_date as any).toISOString()
        const key = `schedule:${id}:${scheduledAtIso}`
        const t = localScheduleRegistry.get(key)
        if (t) clearTimeout(t)
        localScheduleRegistry.delete(key)
      } catch (e) {
        console.warn('[CancelSchedule] Failed to cancel local scheduler (best-effort):', e)
      }
    }

    // Best-effort cancel in QStash
    if (messageId && process.env.QSTASH_TOKEN) {
      try {
        const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN })
        await qstash.messages.delete(messageId)
      } catch (e) {
        // If already executed or not found, we still proceed to clear DB.
        console.warn('[CancelSchedule] Failed to cancel QStash message (best-effort):', e)
      }
    }

    // Clear schedule fields and revert to draft
    await campaignDb.updateStatus(ctx.tenantId, id, {
      status: CampaignStatus.DRAFT,
      scheduledAt: null,
      qstashScheduleMessageId: null,
      qstashScheduleEnqueuedAt: null,
      startedAt: null,
      completedAt: null,
    })

    const updated = await campaignDb.getById(ctx.tenantId, id)
    return NextResponse.json({ ok: true, campaign: updated })
  } catch (error) {
    console.error('Failed to cancel schedule:', error)
    return NextResponse.json(
      { error: 'Falha ao cancelar agendamento', details: (error as Error).message },
      { status: 500 }
    )
  }
}
