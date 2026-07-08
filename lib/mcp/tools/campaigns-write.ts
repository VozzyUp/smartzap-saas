import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ok, err } from '@/lib/mcp/helpers'
import { getAppUrl } from '@/lib/app-url'

const baseUrl = () => getAppUrl()
const apiKey = () => process.env.SMARTZAP_API_KEY ?? ''

const headers = () => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey(),
})

export function registerCampaignsWriteTools(server: McpServer) {
  // ─── sz.campaigns.create ──────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.create',
    {
      title: 'Criar campanha',
      description:
        'Cria uma nova campanha. Para disparar em seguida, use sz.campaigns.start. Para agendar, use scheduledAt.',
      inputSchema: {
        name: z.string().min(1).max(100).describe('Nome da campanha'),
        templateName: z.string().min(1).describe('Nome exato do template WhatsApp'),
        scheduledAt: z
          .string()
          .datetime()
          .optional()
          .describe('Data/hora de disparo agendado (ISO 8601). Omitir para criar como rascunho.'),
        folderId: z.string().uuid().optional().describe('UUID da pasta (opcional)'),
        selectedContactIds: z
          .array(z.string().uuid())
          .optional()
          .describe('IDs de contatos selecionados (audiência manual)'),
        templateVariables: z
          .object({
            header: z.array(z.string()).optional().default([]),
            headerMediaId: z.string().optional(),
            body: z.array(z.string()).optional().default([]),
            buttons: z.record(z.string(), z.string()).optional(),
          })
          .optional()
          .describe('Variáveis do template: { header: [], body: ["valor1", "valor2"] }'),
      },
    },
    async (data) => {
      const res = await fetch(`${baseUrl()}/api/campaigns`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? body.details ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.campaigns.update ──────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.update',
    {
      title: 'Atualizar campanha',
      description: 'Atualiza nome, template ou agendamento de uma campanha (apenas rascunhos).',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
        name: z.string().max(100).optional(),
        templateName: z.string().optional(),
        scheduledAt: z.string().datetime().optional().nullable().describe('null para remover agendamento'),
      },
    },
    async ({ id, ...data }) => {
      const res = await fetch(`${baseUrl()}/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(data),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.campaigns.delete ──────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.delete',
    {
      title: 'Remover campanha',
      description: 'Remove uma campanha. Apenas campanhas em DRAFT ou FAILED podem ser removidas.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/campaigns/${id}`, {
        method: 'DELETE',
        headers: headers(),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.campaigns.start ───────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.start',
    {
      title: 'Disparar campanha agora',
      description: 'Inicia o disparo imediato de uma campanha. A campanha precisa estar em estado DRAFT.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
      },
    },
    async ({ id }) => {
      // Primeiro busca a campanha para obter templateName e contatos
      const getRes = await fetch(`${baseUrl()}/api/campaigns/${id}`, {
        headers: { 'x-api-key': apiKey() },
      })
      if (!getRes.ok) {
        const body = await getRes.json().catch(() => ({}))
        return err(body.error ?? `Campanha não encontrada: HTTP ${getRes.status}`)
      }
      const campaign = await getRes.json()

      // Dispara via /api/campaign/dispatch (endpoint real de envio — não existe /campaigns/:id/start)
      const res = await fetch(`${baseUrl()}/api/campaign/dispatch`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: id,
          templateName: campaign.templateName,
          templateVariables: campaign.templateVariables,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.campaigns.schedule ────────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.schedule',
    {
      title: 'Agendar campanha',
      description: 'Define data e hora de disparo para uma campanha em estado DRAFT.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha'),
        scheduledAt: z
          .string()
          .datetime()
          .describe('Data/hora de disparo em ISO 8601 (ex: 2025-06-15T14:00:00-03:00)'),
      },
    },
    async ({ id, scheduledAt }) => {
      const res = await fetch(`${baseUrl()}/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ scheduledAt, status: 'SCHEDULED' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.campaigns.duplicate ───────────────────────────────────────────────
  server.registerTool(
    'sz.campaigns.duplicate',
    {
      title: 'Duplicar campanha',
      description: 'Cria uma cópia de uma campanha existente como novo rascunho.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da campanha a duplicar'),
        name: z.string().min(1).max(100).optional().describe('Nome para a cópia (padrão: "Cópia de <nome>")'),
      },
    },
    async ({ id, name }) => {
      const res = await fetch(`${baseUrl()}/api/campaigns/${id}/duplicate`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
