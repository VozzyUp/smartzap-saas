import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getTenantContext } from '@/lib/tenant-context'

// Dados por-tenant (via getTenantContext/cookies) — nunca cache por tempo.
// O comentário antigo ("cache no Vercel Edge") não se aplica mais: o app
// saiu do Vercel na Fase 1 e roda self-hosted. Sem force-dynamic, o Data
// Cache do Next podia servir um snapshot de até 60s desatualizado, fazendo
// o card do dashboard não bater com a lista de campanhas logo abaixo.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // NOTA: `campaign_stats_summary` é uma view global (sem coluna tenant_id,
    // agrega TODAS as campanhas de TODOS os tenants) — não pode ser filtrada
    // por tenant, então não é mais usada aqui. Query direta em `campaigns`
    // com `.eq('tenant_id', ...)` substitui o antigo caminho "otimizado".
    const { data, error } = await supabase
      .from('campaigns')
      .select('sent, delivered, read, failed, status')
      .eq('tenant_id', ctx.tenantId)

    if (error) throw error

    // Calculate aggregates
    let totalSent = 0
    let totalDelivered = 0
    let totalRead = 0
    let totalFailed = 0
    let activeCampaigns = 0

    const activeStatuses = new Set([
      'enviando',
      'agendado',
      'sending',
      'scheduled',
    ])

    ;(data || []).forEach(row => {
      totalSent += row.sent || 0
      totalDelivered += row.delivered || 0
      totalRead += row.read || 0
      totalFailed += row.failed || 0
      const status = String(row.status || '').trim().toLowerCase()
      if (activeStatuses.has(status)) {
        activeCampaigns++
      }
    })

    // Calculate delivery rate
    const deliveryRate = totalSent > 0
      ? Math.round((totalDelivered / totalSent) * 100)
      : 0

    return NextResponse.json({
      totalSent,
      totalDelivered,
      totalRead,
      totalFailed,
      activeCampaigns,
      deliveryRate,
    })
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
