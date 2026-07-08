import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ok, err } from '@/lib/mcp/helpers'
import { getAppUrl } from '@/lib/app-url'

const getDb = () => getSupabaseAdmin()!

export function registerTemplatesTools(server: McpServer) {
  // ─── sz.templates.list ───────────────────────────────────────────────────
  server.registerTool(
    'sz.templates.list',
    {
      title: 'Listar templates',
      description: 'Lista todos os templates WhatsApp sincronizados do banco local.',
      inputSchema: {
        status: z
          .enum(['APPROVED', 'PENDING', 'REJECTED', 'PAUSED'])
          .optional()
          .describe('Filtrar por status de aprovação'),
        category: z
          .enum(['MARKETING', 'UTILITY', 'AUTHENTICATION'])
          .optional()
          .describe('Filtrar por categoria'),
      },
    },
    async ({ status, category }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      let query = db
        .from('templates')
        .select('id, name, status, category, language, components, created_at')
        .order('name', { ascending: true })

      if (status) query = query.eq('status', status)
      if (category) query = query.eq('category', category)

      const { data, error } = await query
      if (error) return err(error.message)

      return ok({ templates: data, count: data.length })
    }
  )

  // ─── sz.templates.get ────────────────────────────────────────────────────
  server.registerTool(
    'sz.templates.get',
    {
      title: 'Detalhes do template',
      description: 'Retorna estrutura completa de um template pelo nome.',
      inputSchema: {
        name: z.string().describe('Nome exato do template'),
      },
    },
    async ({ name }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('templates')
        .select('*')
        .eq('name', name)
        .maybeSingle()

      if (error) return err(error.message)
      if (!data) return err(`Template "${name}" não encontrado`)

      return ok(data)
    }
  )

  // ─── sz.templates.sync ───────────────────────────────────────────────────
  server.registerTool(
    'sz.templates.sync',
    {
      title: 'Sincronizar templates da Meta',
      description:
        'Dispara sincronização de templates com a API da Meta. Requer credenciais WhatsApp configuradas.',
      inputSchema: {},
    },
    async () => {
      const res = await fetch(
        `${getAppUrl()}/api/templates/sync`,
        {
          method: 'POST',
          headers: { 'x-api-key': process.env.SMARTZAP_API_KEY ?? '' },
        }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
