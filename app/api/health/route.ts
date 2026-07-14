import { NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { getAppEnv } from '@/lib/app-env'
import { getTenantContext } from '@/lib/tenant-context'
import { isWhatsAppConnected } from '@/lib/whatsapp-credentials'

// Self-hosted: não há dashboard da Vercel para linkar. Mantido como stub
// (retorna sempre null) para não quebrar os consumidores de HealthCheckResult.vercel.
function getVercelDashboardUrl(): string | null {
  return null
}

interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy'
  services: {
    database: {
      status: 'ok' | 'error' | 'not_configured'
      provider: 'supabase' | 'none'
      latency?: number
      message?: string
    }
    qstash: {
      status: 'ok' | 'error' | 'not_configured'
      message?: string
    }
    whatsapp: {
      status: 'ok' | 'error' | 'not_configured'
      source?: 'db' | 'env' | 'none'
      phoneNumber?: string
      message?: string
    }
    webhook: {
      status: 'ok' | 'error' | 'not_configured'
      lastEventAt?: string | null
      message?: string
    }
  }
  vercel?: {
    dashboardUrl: string | null
    storesUrl: string | null
    env: string
  }
  timestamp: string
}

export async function GET() {
  const dashboardUrl = getVercelDashboardUrl()

  const result: HealthCheckResult = {
    overall: 'healthy',
    services: {
      database: { status: 'not_configured', provider: 'none' },
      qstash: { status: 'not_configured' },
      whatsapp: { status: 'not_configured' },
      webhook: { status: 'not_configured' },
    },
    vercel: {
      dashboardUrl,
      storesUrl: dashboardUrl ? `${dashboardUrl}/stores` : null,
      env: getAppEnv(),
    },
    timestamp: new Date().toISOString(),
  }

  // 1. Check Database (Supabase)
  if (isSupabaseConfigured()) {
    try {
      const start = Date.now()
      const { error } = await supabase.from('settings').select('key').limit(1)
      const latency = Date.now() - start

      if (error && !error.message.includes('does not exist')) {
        throw error
      }

      result.services.database = {
        status: 'ok',
        provider: 'supabase',
        latency,
        message: `Supabase connected (${latency}ms)`,
      }
    } catch (error) {
      result.services.database = {
        status: 'error',
        provider: 'supabase',
        message: error instanceof Error ? error.message : (error as any)?.message || 'Connection failed',
      }
      result.overall = 'unhealthy'
    }
  } else {
    result.services.database = {
      status: 'not_configured',
      provider: 'none',
      message: 'Supabase not configured',
    }
    result.overall = 'unhealthy'
  }

  // 2. Check QStash
  if (process.env.QSTASH_TOKEN) {
    result.services.qstash = {
      status: 'ok',
      message: 'Token configured',
    }
  } else {
    result.services.qstash = {
      status: 'not_configured',
      message: 'QSTASH_TOKEN not configured',
    }
    result.overall = 'degraded'
  }

  // 3. Check WhatsApp credentials (por tenant, quando há sessão)
  // Este endpoint atende dois usos: (a) health check de infra sem sessão
  // (Docker HEALTHCHECK, Traefik) — aí não há tenant e reportamos not_configured;
  // (b) chamada do DashboardShell com a sessão do usuário — aí resolvemos o
  // tenant e probamos as credenciais dele (o DashboardShell usa este status
  // para avançar o onboarding; sem isso, o wizard trava na tela de boas-vindas).
  try {
    const ctx = await getTenantContext()
    if (ctx?.tenantId) {
      const connected = await isWhatsAppConnected(ctx.tenantId)
      result.services.whatsapp = {
        status: connected ? 'ok' : 'not_configured',
        source: connected ? 'db' : 'none',
        message: connected
          ? 'Credenciais WhatsApp configuradas para o tenant'
          : 'Credenciais WhatsApp não configuradas para o tenant',
      }
    } else {
      result.services.whatsapp = {
        status: 'not_configured',
        source: 'none',
        message: 'Health check de infra (sem sessão) — verificação por tenant não aplicável',
      }
    }
  } catch {
    result.services.whatsapp = {
      status: 'not_configured',
      source: 'none',
      message: 'Não foi possível verificar credenciais WhatsApp',
    }
  }

  // 4. Check Webhook status (only if database is configured)
  if (isSupabaseConfigured()) {
    try {
      let lastEventAt: string | null = null
      let hasRecentEvents = false
      let hasWebhookToken = false

      // Estratégia 1: Verificar eventos recentes em whatsapp_status_events
      try {
        const { data: events, error } = await supabase
          .from('whatsapp_status_events')
          .select('last_received_at')
          .order('last_received_at', { ascending: false })
          .limit(1)

        if (!error && events && events.length > 0) {
          lastEventAt = events[0].last_received_at
          if (lastEventAt) {
            const eventDate = new Date(lastEventAt)
            const now = new Date()
            const hoursSinceLastEvent = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60)
            hasRecentEvents = hoursSinceLastEvent < 24
          }
        }
      } catch {
        // Tabela pode não existir ainda
      }

      // Estratégia 2: Verificar entregas/leituras em campaign_contacts
      if (!hasRecentEvents) {
        try {
          const { data: deliveries, error } = await supabase
            .from('campaign_contacts')
            .select('delivered_at, read_at')
            .or('delivered_at.not.is.null,read_at.not.is.null')
            .order('delivered_at', { ascending: false })
            .limit(1)

          if (!error && deliveries && deliveries.length > 0) {
            const delivery = deliveries[0]
            const latestDelivery = delivery.read_at || delivery.delivered_at
            if (latestDelivery) {
              if (!lastEventAt || new Date(latestDelivery) > new Date(lastEventAt)) {
                lastEventAt = latestDelivery
              }
              const eventDate = new Date(latestDelivery)
              const now = new Date()
              const hoursSinceLastEvent = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60)
              hasRecentEvents = hoursSinceLastEvent < 24
            }
          }
        } catch {
          // ignore
        }
      }

      // Estratégia 3: Verificar se existe token de webhook configurado
      // (settings agora é por tenant — sem tenant específico neste health check
      // público, não há como probar sem hardcodar um tenantId. Pulamos esta
      // estratégia até a Fase 2B trazer um checkup por tenant.)

      // Decidir resultado do webhook
      if (hasRecentEvents && lastEventAt) {
        result.services.webhook = {
          status: 'ok',
          lastEventAt,
          message: 'Webhook recebendo eventos normalmente',
        }
      } else if (lastEventAt) {
        // Tem eventos mas não são recentes (ainda consideramos OK, só mais de 24h)
        result.services.webhook = {
          status: 'ok',
          lastEventAt,
          message: 'Webhook configurado (sem eventos nas últimas 24h)',
        }
      } else if (hasWebhookToken) {
        // Tem token mas nunca recebeu eventos
        result.services.webhook = {
          status: 'not_configured',
          lastEventAt: null,
          message: 'Token configurado, aguardando primeiro evento',
        }
      } else {
        // Nenhuma indicação de webhook funcionando
        result.services.webhook = {
          status: 'not_configured',
          lastEventAt: null,
          message: 'Webhook não configurado',
        }
      }
    } catch (error) {
      result.services.webhook = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Erro ao verificar webhook',
      }
    }
  }

  // Determine overall status
  // Webhook não é crítico para o overall - só database, qstash, whatsapp
  const criticalServices = ['database', 'qstash', 'whatsapp'] as const
  const criticalStatuses = criticalServices.map(s => result.services[s].status)

  if (criticalStatuses.every(s => s === 'ok')) {
    result.overall = 'healthy'
  } else if (criticalStatuses.some(s => s === 'error') || criticalStatuses.filter(s => s === 'not_configured').length > 1) {
    result.overall = 'unhealthy'
  } else {
    result.overall = 'degraded'
  }

  return NextResponse.json(result, {
    headers: {
      // Health check não deve ser cacheado - precisa refletir estado real
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}
