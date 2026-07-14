import { NextResponse } from 'next/server'
import { supabase, getSupabaseAdmin } from '@/lib/supabase'
import { fetchWithTimeout } from '@/lib/server-http'
import { getAppEnv } from '@/lib/app-env'
import { getTenantContext } from '@/lib/tenant-context'

/**
 * GET /api/system
 * 
 * Consolidated endpoint that returns:
 * - Health status of all services
 * - Usage metrics for Vercel, Supabase, WhatsApp, QStash
 * - Vercel deployment info
 * 
 * This replaces 3 separate API calls with 1, reducing function invocations.
 */

// === TYPES ===

interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy'
  services: {
    database: { status: 'ok' | 'error' | 'not_configured'; latency?: number; message?: string }
    qstash: { status: 'ok' | 'error' | 'not_configured'; message?: string }
    whatsapp: { status: 'ok' | 'error' | 'not_configured'; source?: string; phoneNumber?: string; message?: string }
  }
}

interface UsageData {
  vercel: {
    plan: 'hobby' | 'pro' | 'enterprise' | 'unknown'
    functionInvocations: number
    functionLimit: number
    functionPercentage: number
    edgeRequests: number
    edgeLimit: number
    edgePercentage: number
    buildMinutes: number
    buildLimit: number
    buildPercentage: number
    percentage: number
    status: 'ok' | 'warning' | 'critical'
  }
  database: {
    plan: 'free' | 'pro' | 'team' | 'enterprise' | 'unknown'
    storageMB: number
    limitMB: number
    bandwidthMB: number
    bandwidthLimitMB: number
    percentage: number
    rowsRead: number
    rowsWritten: number
    status: 'ok' | 'warning' | 'critical'
  }
  whatsapp: {
    messagesSent: number
    tier: string
    tierLimit: number
    percentage: number
    quality: string
    status: 'ok' | 'warning' | 'critical'
  }
  qstash: {
    messagesMonth: number
    messagesLimit: number
    percentage: number
    cost: number
    status: 'ok' | 'warning' | 'critical'
  }
}

interface VercelInfo {
  dashboardUrl: string | null
  storesUrl: string | null
  env: string
}

interface SystemResponse {
  health: HealthStatus
  usage: UsageData
  vercel: VercelInfo
  timestamp: string
}

// === HELPERS ===

function getStatus(percentage: number): 'ok' | 'warning' | 'critical' {
  if (percentage >= 90) return 'critical'
  if (percentage >= 70) return 'warning'
  return 'ok'
}

// Self-hosted: não há dashboard da Vercel para linkar. Mantido como stub
// (retorna sempre null) para não quebrar os consumidores de SystemResponse.vercel.
function buildVercelDashboardUrl(): string | null {
  return null
}

// === MAIN HANDLER ===

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.isPlatformAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const startTime = Date.now()

  // Initialize response structure
  const response: SystemResponse = {
    health: {
      overall: 'healthy',
      services: {
        database: { status: 'not_configured' },
        qstash: { status: 'not_configured' },
        whatsapp: { status: 'not_configured' },
      },
    },
    usage: {
      vercel: {
        plan: 'unknown',
        functionInvocations: 0,
        functionLimit: 100000,
        functionPercentage: 0,
        edgeRequests: 0,
        edgeLimit: 1000000,
        edgePercentage: 0,
        buildMinutes: 0,
        buildLimit: 6000,
        buildPercentage: 0,
        percentage: 0,
        status: 'ok',
      },
      database: { plan: 'unknown', storageMB: 0, limitMB: 500, bandwidthMB: 0, bandwidthLimitMB: 5000, percentage: 0, rowsRead: 0, rowsWritten: 0, status: 'ok' },
      whatsapp: { messagesSent: 0, tier: 'STANDARD', tierLimit: 100000, percentage: 0, quality: 'GREEN', status: 'ok' },
      qstash: { messagesMonth: 0, messagesLimit: 500, percentage: 0, cost: 0, status: 'ok' },
    },
    vercel: {
      dashboardUrl: buildVercelDashboardUrl(),
      storesUrl: null,
      env: getAppEnv(),
    },
    timestamp: new Date().toISOString(),
  }

  // Build stores URL
  if (response.vercel.dashboardUrl) {
    response.vercel.storesUrl = `${response.vercel.dashboardUrl}/stores`
  }

  // === PARALLEL CHECKS ===
  await Promise.all([
    // 1. DATABASE (Supabase)
    (async () => {
      const hasPublishableKey =
        !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
      if (process.env.NEXT_PUBLIC_SUPABASE_URL && hasPublishableKey) {
        try {
          const start = Date.now()

          const supabaseAdmin = getSupabaseAdmin()
          if (!supabaseAdmin) throw new Error('Missing Supabase credentials')

          const { error } = await supabaseAdmin.from('campaigns').select('id').limit(1)
          if (error && !error.message.includes('No rows')) throw error

          response.health.services.database = { status: 'ok', latency: Date.now() - start }

          // Estimate database size from row counts
          let actualSizeMB = 0
          try {
            const { data: sizeData } = await supabaseAdmin.rpc('get_db_size')
            if (sizeData) {
              actualSizeMB = Math.round((sizeData / (1024 * 1024)) * 100) / 100
            } else {
              throw new Error('RPC not found')
            }
          } catch {
            const [
              { count: campaignsCount },
              { count: contactsCount },
              { count: campaignContactsCount }
            ] = await Promise.all([
              supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }),
              supabaseAdmin.from('contacts').select('*', { count: 'exact', head: true }),
              supabaseAdmin.from('campaign_contacts').select('*', { count: 'exact', head: true })
            ])

            const totalRows = (campaignsCount || 0) + (contactsCount || 0) + (campaignContactsCount || 0)
            actualSizeMB = Math.round((totalRows * 1024) / (1024 * 1024) * 100) / 100
          }

          response.usage.database.storageMB = actualSizeMB

          // Detect plan via Supabase Management API if token available
          const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
          const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
          const projectRef = projectUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]

          if (supabaseToken && projectRef) {
            try {
              const projectsRes = await fetchWithTimeout('https://api.supabase.com/v1/projects', {
                headers: { 'Authorization': `Bearer ${supabaseToken}` },
                timeoutMs: 3500,
              })

              if (projectsRes.ok) {
                const projects = await projectsRes.json()
                const project = projects.find((p: any) => p.ref === projectRef)

                if (project?.organization_id) {
                  const orgRes = await fetchWithTimeout(`https://api.supabase.com/v1/organizations/${project.organization_id}`, {
                    headers: { 'Authorization': `Bearer ${supabaseToken}` },
                    timeoutMs: 3500,
                  })

                  if (orgRes.ok) {
                    const org = await orgRes.json()
                    const orgPlan = org.plan?.toLowerCase() || 'free'

                    if (orgPlan === 'enterprise') {
                      response.usage.database.plan = 'enterprise'
                      response.usage.database.limitMB = 1000000
                    } else if (orgPlan === 'team') {
                      response.usage.database.plan = 'team'
                      response.usage.database.limitMB = 8000
                    } else if (orgPlan === 'pro') {
                      response.usage.database.plan = 'pro'
                      response.usage.database.limitMB = 8000
                    } else {
                      response.usage.database.plan = 'free'
                      response.usage.database.limitMB = 500
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Failed to get Supabase plan:', e)
              response.usage.database.plan = 'unknown'
              response.usage.database.limitMB = 500
            }
          } else {
            if (actualSizeMB > 400) {
              response.usage.database.plan = 'pro'
              response.usage.database.limitMB = 8000
              response.usage.database.bandwidthLimitMB = 250000
            } else {
              response.usage.database.plan = 'free'
              response.usage.database.limitMB = 500
              response.usage.database.bandwidthLimitMB = 5000
            }
          }

          // Set bandwidth limit based on detected plan
          if (response.usage.database.plan === 'pro' || response.usage.database.plan === 'team') {
            response.usage.database.bandwidthLimitMB = 250000
          } else if (response.usage.database.plan === 'enterprise') {
            response.usage.database.bandwidthLimitMB = 1000000
          } else {
            response.usage.database.bandwidthLimitMB = 5000
          }

          // Get WhatsApp messages sent
          // Observação importante:
          // O “tier” do WhatsApp (whatsapp_business_manager_messaging_limit) é uma janela móvel
          // de ~24h e é baseado em destinatários/contatos únicos, não em “mês” ou “30 dias”.
          // Se compararmos 30 dias de envios com um limite /24h, a % fica “travada” e confusa.
          //
          // Aqui usamos campaign_contacts como proxy de “destinatários únicos enviados nas últimas 24h”.
          // Preferimos contact_id (quando existe) e fazemos fallback para phone.
          try {
            const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            const uniqueRecipients = new Set<string>()

            const pageSize = 5000
            const maxRows = 200000 // safety guard

            for (let offset = 0; offset < maxRows; offset += pageSize) {
              const { data: rows, error: rowsError } = await supabase
                .from('campaign_contacts')
                .select('contact_id,phone')
                .gte('sent_at', cutoffIso)
                .not('sent_at', 'is', null)
                .range(offset, offset + pageSize - 1)

              if (rowsError) throw rowsError
              if (!rows || rows.length === 0) break

              for (const r of rows as any[]) {
                const key = String(r?.contact_id || r?.phone || '').trim()
                if (key) uniqueRecipients.add(key)
              }

              if (rows.length < pageSize) break
            }

            response.usage.whatsapp.messagesSent = uniqueRecipients.size
          } catch (e) {
            console.warn('[System] Falha ao calcular destinatários únicos 24h (best-effort):', e)
            response.usage.whatsapp.messagesSent = 0
          }
        } catch (error) {
          response.health.services.database = { status: 'error', message: (error as Error).message }
          response.health.overall = 'unhealthy'
        }
      } else {
        response.health.services.database = { status: 'not_configured', message: 'Supabase credentials not set' }
        response.health.overall = 'unhealthy'
      }
    })(),

    // 2. QSTASH (with usage stats)
    (async () => {
      if (process.env.QSTASH_TOKEN) {
        response.health.services.qstash = { status: 'ok', message: 'Token configured' }

        // Tentar env vars primeiro, depois banco de dados
        let upstashEmail = process.env.UPSTASH_EMAIL
        let upstashApiKey = process.env.UPSTASH_API_KEY

        // Se não tiver env var, buscar do banco
        if (!upstashEmail || !upstashApiKey) {
          try {
            const { data: settingsData } = await supabase
              .from('settings')
              .select('key, value')
              .in('key', ['upstashEmail', 'upstashApiKey'])

            if (settingsData) {
              const settingsMap = new Map(settingsData.map(s => [s.key, s.value]))
              upstashEmail = upstashEmail || (settingsMap.get('upstashEmail') as string) || ''
              upstashApiKey = upstashApiKey || (settingsMap.get('upstashApiKey') as string) || ''
            }
          } catch {
            // Ignore errors fetching from DB
          }
        }

        if (upstashEmail && upstashApiKey) {
          try {
            const auth = Buffer.from(`${upstashEmail}:${upstashApiKey}`).toString('base64')
            const statsRes = await fetchWithTimeout('https://api.upstash.com/v2/qstash/stats', {
              headers: { 'Authorization': `Basic ${auth}` },
              timeoutMs: 3500,
            })

            if (statsRes.ok) {
              const stats = await statsRes.json()
              const monthlyMessages = stats.daily_requests?.reduce((sum: number, day: any) => sum + (day.y || 0), 0) || 0
              const monthlyBilling = stats.total_monthly_billing || 0
              const isPayAsYouGo = monthlyBilling > 0 || monthlyMessages > 500

              response.usage.qstash = {
                messagesMonth: monthlyMessages,
                messagesLimit: isPayAsYouGo ? 0 : 500,
                percentage: isPayAsYouGo ? 0 : Math.round((monthlyMessages / 500) * 100 * 10) / 10,
                cost: monthlyBilling,
                status: isPayAsYouGo ? 'ok' : getStatus(Math.round((monthlyMessages / 500) * 100)) as 'ok' | 'warning' | 'critical'
              }
            }
          } catch (e) {
            console.error('Failed to get QStash stats:', e)
          }
        }
      } else {
        response.health.services.qstash = { status: 'not_configured', message: 'QSTASH_TOKEN not set' }
        response.health.overall = 'degraded'
      }
    })(),

    // 3. WHATSAPP
    // /api/system é um endpoint público (sem sessão) — ver PUBLIC_ENDPOINTS em
    // lib/auth.ts. Credenciais WhatsApp agora são por tenant (Fase 2A) e não
    // há um tenant específico para sondar aqui sem hardcodar um tenantId
    // (proibido pelas convenções de multi-tenancy). Reportamos como
    // não-aplicável até a Fase 2B trazer um checkup por tenant.
    (async () => {
      response.health.services.whatsapp = {
        status: 'not_configured',
        source: 'none',
        message: 'Verificação por tenant não disponível neste endpoint multi-tenant (Fase 2B)',
      }
    })(),

    // 4. VERCEL USAGE — não aplicável em instalação self-hosted.
    // Nenhuma chamada à API da Vercel é feita; os campos permanecem zerados/ok.
    (async () => {})(),
  ])

  // === POST-CALCULATIONS ===
  if (response.usage.whatsapp.tierLimit > 0) {
    response.usage.whatsapp.percentage = Math.round((response.usage.whatsapp.messagesSent / response.usage.whatsapp.tierLimit) * 100 * 10) / 10
    response.usage.whatsapp.status = getStatus(response.usage.whatsapp.percentage)
  }

  if (response.usage.database.limitMB > 0) {
    const rawPct = (response.usage.database.storageMB / response.usage.database.limitMB) * 100
    response.usage.database.percentage = rawPct > 0 && rawPct < 0.1 ? 0.1 : Math.round(rawPct * 10) / 10
    response.usage.database.status = getStatus(response.usage.database.percentage)
  }

  // Recalculate overall health
  const statuses = Object.values(response.health.services).map(s => s.status)
  if (statuses.every(s => s === 'ok')) {
    response.health.overall = 'healthy'
  } else if (statuses.some(s => s === 'error') || statuses.filter(s => s === 'not_configured').length > 1) {
    response.health.overall = 'unhealthy'
  } else {
    response.health.overall = 'degraded'
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      'X-Response-Time': `${Date.now() - startTime}ms`,
    },
  })
}
