import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ok, err } from '@/lib/mcp/helpers'
import { getAppUrl } from '@/lib/app-url'

const getDb = () => getSupabaseAdmin()!
const baseUrl = () => getAppUrl()

export function registerCampaignsTools(server: McpServer) {
  // ─── sz.campaigns.list ───────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.list',
    {
      title: 'Listar campanhas',
      description: 'Lista campanhas com filtro de status opcional.',
      inputSchema: {
        status: z
          .enum(['Rascunho', 'Agendado', 'Enviando', 'Concluído', 'Pausado', 'Falhou'])
          .optional()
          .describe('Filtrar por status'),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ status, limit }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      let query = db
        .from('campaigns')
        .select(
          'id, name, status, template_name, total_recipients, sent, delivered, read, failed, scheduled_date, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(limit)

      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) return err(error.message)

      return ok({ campaigns: data, count: data.length })
    }
  )

  // ─── sz.campaigns.get ────────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.get',
    {
      title: 'Detalhes da campanha',
      description:
        'Retorna detalhes completos de uma campanha incluindo métricas de entrega.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
      },
    },
    async ({ id }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) return err(error.message)
      if (!data) return err('Campanha não encontrada')

      return ok(data)
    }
  )

  // ─── sz.campaigns.metrics ────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.metrics',
    {
      title: 'Métricas de campanha',
      description: 'Retorna breakdown detalhado de status dos contatos de uma campanha.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
      },
    },
    async ({ id }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('campaign_contacts')
        .select('status')
        .eq('campaign_id', id)

      if (error) return err(error.message)

      const breakdown: Record<string, number> = {}
      for (const { status } of data ?? []) {
        breakdown[status] = (breakdown[status] ?? 0) + 1
      }

      return ok({ campaignId: id, total: data.length, breakdown })
    }
  )

  // ─── sz.campaigns.messages ───────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.messages',
    {
      title: 'Mensagens da campanha',
      description: 'Lista os contatos e status de envio de uma campanha (falhas e pendentes).',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
        status: z
          .enum(['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'])
          .optional()
          .describe('Filtrar por status'),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ id, status, limit }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      let query = db
        .from('campaign_contacts')
        .select('id, contact_id, phone, status, message_id, error_code, error_message, sent_at, delivered_at')
        .eq('campaign_id', id)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) return err(error.message)

      return ok({ messages: data, count: data.length })
    }
  )

  // ─── sz.campaigns.pause ──────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.pause',
    {
      title: 'Pausar campanha',
      description: 'Pausa uma campanha em andamento.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/campaign/${id}/pause`, {
        method: 'POST',
        headers: { 'x-api-key': process.env.SMARTZAP_API_KEY ?? '' },
      })
      const body = await res.json()
      if (!res.ok) return err(body.error ?? 'Erro ao pausar campanha')
      return ok(body)
    }
  )

  // ─── sz.campaigns.resume ─────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.resume',
    {
      title: 'Retomar campanha',
      description: 'Retoma uma campanha pausada.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/campaign/${id}/resume`, {
        method: 'POST',
        headers: { 'x-api-key': process.env.SMARTZAP_API_KEY ?? '' },
      })
      const body = await res.json()
      if (!res.ok) return err(body.error ?? 'Erro ao retomar campanha')
      return ok(body)
    }
  )
}
