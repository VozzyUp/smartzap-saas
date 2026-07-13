import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getMcpContext } from '@/lib/mcp/context'
import { ok, err } from '@/lib/mcp/helpers'
import { getAppUrl } from '@/lib/app-url'
import { resolveWebhookTenantId } from '@/lib/tenant-context'

const getDb = () => getSupabaseAdmin()!
const baseUrl = () => getAppUrl()
const apiKey = () => process.env.SMARTZAP_API_KEY ?? ''

export function registerSystemTools(server: McpServer) {
  // ─── sz.health.check ─────────────────────────────────────────────────────
  server.registerTool(
    'sz.health.check',
    {
      title: 'Health check',
      description: 'Verifica conectividade com banco, credenciais WhatsApp e fila QStash.',
      inputSchema: {},
    },
    async () => {
      const res = await fetch(`${baseUrl()}/api/health`)
      const body = await res.json().catch(() => ({}))
      return ok(body)
    }
  )

  // ─── sz.settings.credentials_status ─────────────────────────────────────
  server.registerTool(
    'sz.settings.credentials_status',
    {
      title: 'Status das credenciais WhatsApp',
      description:
        'Verifica se as credenciais WhatsApp estão configuradas. Nunca retorna os valores das chaves.',
      inputSchema: {},
    },
    async () => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data } = await db
        .from('settings')
        .select('key')
        .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token', 'whatsapp_business_id'])

      const keys = new Set((data ?? []).map((r) => r.key))
      return ok({
        hasPhoneNumberId: keys.has('whatsapp_phone_number_id'),
        hasAccessToken: keys.has('whatsapp_access_token'),
        hasBusinessAccountId: keys.has('whatsapp_business_id'),
        fullyConfigured:
          keys.has('whatsapp_phone_number_id') &&
          keys.has('whatsapp_access_token') &&
          keys.has('whatsapp_business_id'),
      })
    }
  )

  // ─── sz.settings.ai_status ───────────────────────────────────────────────
  server.registerTool(
    'sz.settings.ai_status',
    {
      title: 'Status da configuração de IA',
      description: 'Retorna provider e modelo ativos. Nunca retorna as chaves API.',
      inputSchema: {},
    },
    async () => {
      const res = await fetch(`${baseUrl()}/api/settings/ai`, {
        headers: { 'x-api-key': apiKey() },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)

      // Remove chaves sensíveis da resposta
      const { googleApiKey: _g, openaiApiKey: _o, ...safe } = body
      return ok({
        ...safe,
        hasGoogleKey: !!body.googleApiKey,
        hasOpenAIKey: !!body.openaiApiKey,
      })
    }
  )

  // ─── sz.debug.alerts ─────────────────────────────────────────────────────
  server.registerTool(
    'sz.debug.alerts',
    {
      title: 'Alertas recentes da conta',
      description: 'Lista alertas e erros de entrega recentes (erros Meta, rate limits, etc.).',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ limit }) => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('account_alerts')
        .select('id, type, message, details, created_at, resolved_at')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) return err(error.message)
      return ok({ alerts: data, count: data.length })
    }
  )

  // ─── sz.debug.campaign_contacts ──────────────────────────────────────────
  server.registerTool(
    'sz.debug.campaign_contacts',
    {
      title: 'Contatos com falha em campanha',
      description: 'Lista contatos com erro de entrega em uma campanha específica.',
      inputSchema: {
        campaignId: z.string().uuid().describe('UUID da campanha'),
        status: z
          .enum(['FAILED', 'PENDING', 'SKIPPED'])
          .default('FAILED')
          .describe('Status para filtrar'),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ campaignId, status, limit }) => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('campaign_contacts')
        .select('id, phone, status, error_code, error_message, sent_at, updated_at')
        .eq('campaign_id', campaignId)
        .eq('status', status)
        .order('updated_at', { ascending: false })
        .limit(limit)

      if (error) return err(error.message)
      return ok({ contacts: data, count: data.length, status })
    }
  )

  // ─── sz.debug.stress_ai ──────────────────────────────────────────────────
  server.registerTool(
    'sz.debug.stress_ai',
    {
      title: 'Stress test do pipeline de IA',
      description:
        'Executa N conversas em paralelo diretamente no chat-agent (dry-run — sem enviar WhatsApp real). ' +
        'Mede latência, taxa de sucesso e erros. Use para detectar rate limits, timeouts e gargalos.',
      inputSchema: {
        total: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Total de conversas a simular'),
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Conversas simultâneas (pool de concorrência)'),
        turns: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(2)
          .describe('Turnos de mensagem por conversa'),
      },
    },
    async ({ total, concurrency, turns }) => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const db = getDb()
      if (!db) return err('Banco não configurado')

      // Busca agente ativo
      const { data: agent, error: agentErr } = await db
        .from('ai_agents')
        .select('*')
        .eq('is_active', true)
        .eq('is_default', true)
        .single()

      if (agentErr || !agent) return err('Agente IA padrão não encontrado')

      // Cenários de mensagens
      const SCENARIOS = [
        { name: 'saudacao', messages: ['Oi, tudo bem?', 'Quero saber sobre os cursos'] },
        { name: 'duvida_tecnica', messages: ['Não consigo acessar minha conta', 'Dá erro quando tento entrar'] },
        { name: 'preco', messages: ['Quanto custa o plano?', 'Tem desconto para anual?'] },
        { name: 'reclamacao', messages: ['Estou insatisfeito com o serviço', 'Quero cancelar'] },
        { name: 'elogio', messages: ['Adorei o produto!', 'Vocês são ótimos'] },
      ]

      type TurnResult = { success: boolean; latencyMs: number; error?: string }
      type ConvResult = {
        id: number
        scenario: string
        success: boolean
        turns: TurnResult[]
        totalMs: number
      }

      // Simula uma conversa com N turnos
      async function runConversation(idx: number): Promise<ConvResult> {
        // Ferramenta MCP administrativa, sem contexto de sessão/tenant — guard
        // intencional até a Fase 2B (ver resolveWebhookTenantId).
        const tenantId = await resolveWebhookTenantId()
        const scenario = SCENARIOS[idx % SCENARIOS.length]
        const convStart = Date.now()
        const turnResults: TurnResult[] = []
        const messages: any[] = []
        const fakeConvId = `stress-${idx}-${Date.now()}`

        let success = true

        for (let t = 0; t < Math.min(turns, scenario.messages.length); t++) {
          const userMsg = scenario.messages[t]
          messages.push({
            id: `msg-${idx}-${t}`,
            conversation_id: fakeConvId,
            direction: 'inbound' as const,
            content: userMsg,
            message_type: 'text' as const,
            media_url: null,
            whatsapp_message_id: null,
            delivery_status: 'delivered' as const,
            ai_response_id: null,
            ai_sentiment: null,
            ai_sources: null,
            payload: null,
            created_at: new Date().toISOString(),
            delivered_at: null,
            read_at: null,
            failed_at: null,
            failure_reason: null,
            failure_code: null,
            failure_title: null,
          })

          const fakeConversation = {
            id: fakeConvId,
            contact_id: null,
            ai_agent_id: agent.id,
            phone: `+5511999${String(idx).padStart(6, '0')}`,
            status: 'open' as const,
            mode: 'bot' as const,
            priority: 'normal' as const,
            unread_count: 1,
            total_messages: messages.length,
            last_message_at: new Date().toISOString(),
            last_message_preview: userMsg,
            automation_paused_until: null,
            automation_paused_by: null,
            handoff_summary: null,
            human_mode_expires_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }

          const tStart = Date.now()
          try {
            const { processChatAgent } = await import('@/lib/ai/agents/chat-agent')
            const result = await processChatAgent({
              tenantId,
              agent,
              conversation: fakeConversation,
              messages: [...messages],
            })

            const latencyMs = Date.now() - tStart
            turnResults.push({ success: result.success, latencyMs, error: result.error })
            if (!result.success) success = false

            // Adiciona resposta fake do bot para manter contexto multi-turno
            if (result.response?.message) {
              messages.push({
                id: `msg-${idx}-${t}-bot`,
                conversation_id: fakeConvId,
                direction: 'outbound' as const,
                content: result.response.message,
                message_type: 'text' as const,
                media_url: null,
                whatsapp_message_id: null,
                delivery_status: 'sent' as const,
                ai_response_id: null,
                ai_sentiment: null,
                ai_sources: null,
                payload: null,
                created_at: new Date().toISOString(),
                delivered_at: null,
                read_at: null,
                failed_at: null,
                failure_reason: null,
                failure_code: null,
                failure_title: null,
              })
            }
          } catch (e) {
            const latencyMs = Date.now() - tStart
            const msg = e instanceof Error ? e.message : String(e)
            turnResults.push({ success: false, latencyMs, error: msg })
            success = false
          }
        }

        return { id: idx, scenario: scenario.name, success, turns: turnResults, totalMs: Date.now() - convStart }
      }

      // Pool de concorrência
      const globalStart = Date.now()
      const results: ConvResult[] = []
      const queue = Array.from({ length: total }, (_, i) => i)

      async function worker() {
        while (queue.length > 0) {
          const idx = queue.shift()!
          results.push(await runConversation(idx))
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
      const durationMs = Date.now() - globalStart

      // Métricas
      const allTurns = results.flatMap((r) => r.turns)
      const successfulTurns = allTurns.filter((t) => t.success)
      const latencies = successfulTurns.map((t) => t.latencyMs).sort((a, b) => a - b)

      const pct = (p: number) =>
        latencies.length === 0 ? 0 : latencies[Math.floor((latencies.length - 1) * p)]

      const avg =
        latencies.length === 0 ? 0 : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)

      const successConvs = results.filter((r) => r.success).length
      const errorMap: Record<string, number> = {}
      for (const t of allTurns.filter((t) => !t.success && t.error)) {
        const key = t.error!.slice(0, 80)
        errorMap[key] = (errorMap[key] ?? 0) + 1
      }

      const scenarioStats: Record<string, { total: number; ok: number; avgMs: number }> = {}
      for (const r of results) {
        if (!scenarioStats[r.scenario]) scenarioStats[r.scenario] = { total: 0, ok: 0, avgMs: 0 }
        scenarioStats[r.scenario].total++
        if (r.success) scenarioStats[r.scenario].ok++
        const lats = r.turns.filter((t) => t.success).map((t) => t.latencyMs)
        scenarioStats[r.scenario].avgMs =
          lats.length > 0 ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0
      }

      return ok({
        config: { total, concurrency, turns },
        agent: { id: agent.id, name: agent.name, model: agent.model },
        summary: {
          conversations: { total, success: successConvs, failed: total - successConvs },
          turns: { total: allTurns.length, success: successfulTurns.length, failed: allTurns.length - successfulTurns.length },
          success_rate_pct: Math.round((successConvs / total) * 100),
          duration_ms: durationMs,
          throughput_rps: Number((total / (durationMs / 1000)).toFixed(2)),
        },
        latency: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), avg, min: latencies[0] ?? 0, max: latencies[latencies.length - 1] ?? 0 },
        errors: Object.entries(errorMap)
          .sort((a, b) => b[1] - a[1])
          .map(([message, count]) => ({ count, message })),
        by_scenario: scenarioStats,
      })
    }
  )

  // ─── sz.debug.test_connection ────────────────────────────────────────────
  server.registerTool(
    'sz.debug.test_connection',
    {
      title: 'Testar conexão WhatsApp',
      description: 'Verifica se as credenciais WhatsApp estão válidas chamando a API da Meta.',
      inputSchema: {},
    },
    async () => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const res = await fetch(`${baseUrl()}/api/settings/test-connection`, {
        method: 'POST',
        headers: { 'x-api-key': process.env.SMARTZAP_ADMIN_KEY ?? '' },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
