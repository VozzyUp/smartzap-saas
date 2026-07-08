import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ok, err } from '@/lib/mcp/helpers'
import { getAppUrl } from '@/lib/app-url'

const baseUrl = () => getAppUrl()
const apiKey = () => process.env.SMARTZAP_API_KEY ?? ''
const adminKey = () => process.env.SMARTZAP_ADMIN_KEY ?? ''

const headers = (admin = false) => ({
  'Content-Type': 'application/json',
  'x-api-key': admin ? adminKey() : apiKey(),
})

export function registerFlowsTools(server: McpServer) {
  // ─── sz.flows.list ────────────────────────────────────────────────────────
  server.registerTool(
    'sz.flows.list',
    {
      title: 'Listar fluxos de automação',
      description: 'Lista todos os fluxos de automação (Workflow Builder) configurados.',
      inputSchema: {},
    },
    async () => {
      const res = await fetch(`${baseUrl()}/api/flows`, {
        headers: { 'x-api-key': apiKey() },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.flows.get ─────────────────────────────────────────────────────────
  server.registerTool(
    'sz.flows.get',
    {
      title: 'Detalhes do fluxo',
      description: 'Retorna configuração completa de um fluxo de automação pelo ID.',
      inputSchema: {
        id: z.string().uuid().describe('UUID do fluxo'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/flows/${id}`, {
        headers: { 'x-api-key': apiKey() },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.flows.delete ──────────────────────────────────────────────────────
  server.registerTool(
    'sz.flows.delete',
    {
      title: 'Remover fluxo',
      description: 'Remove um fluxo de automação pelo ID. Conversas ativas no fluxo serão encerradas.',
      inputSchema: {
        id: z.string().uuid().describe('UUID do fluxo a remover'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/flows/${id}`, {
        method: 'DELETE',
        headers: headers(true),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
