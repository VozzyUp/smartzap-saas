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

export function registerContactsWriteTools(server: McpServer) {
  // ─── sz.contacts.create ───────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.create',
    {
      title: 'Criar contato',
      description: 'Cria um novo contato. Retorna o contato criado.',
      inputSchema: {
        name: z.string().min(1).max(100).describe('Nome completo'),
        phone: z.string().describe('Telefone no formato E.164: +5511999999999'),
        email: z.string().email().optional().describe('Email (opcional)'),
        status: z
          .enum(['OPT_IN', 'OPT_OUT', 'UNKNOWN'])
          .optional()
          .default('OPT_IN')
          .describe('Status de opt-in'),
        tags: z.array(z.string().max(50)).max(20).optional().describe('Tags (máx. 20)'),
        notes: z.string().max(500).optional().describe('Notas internas'),
        custom_fields: z.record(z.string(), z.any()).optional().describe('Campos customizados'),
      },
    },
    async (data) => {
      const res = await fetch(`${baseUrl()}/api/contacts`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? body.details ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.contacts.update ───────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.update',
    {
      title: 'Atualizar contato',
      description: 'Atualiza campos de um contato existente. Envia apenas os campos que deseja alterar.',
      inputSchema: {
        id: z.string().uuid().describe('UUID do contato'),
        name: z.string().min(1).max(100).optional(),
        phone: z.string().optional().describe('Telefone no formato E.164'),
        email: z.string().email().optional().nullable(),
        status: z.enum(['OPT_IN', 'OPT_OUT', 'UNKNOWN']).optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
        notes: z.string().max(500).optional(),
        custom_fields: z.record(z.string(), z.any()).optional(),
      },
    },
    async ({ id, ...data }) => {
      const res = await fetch(`${baseUrl()}/api/contacts/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(data),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.contacts.delete ───────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.delete',
    {
      title: 'Remover contatos',
      description: 'Remove um ou mais contatos pelo ID.',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1).describe('Lista de UUIDs a remover'),
      },
    },
    async ({ ids }) => {
      const res = await fetch(`${baseUrl()}/api/contacts`, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ ids }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.contacts.import ───────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.import',
    {
      title: 'Importar contatos em bulk',
      description:
        'Importa múltiplos contatos de uma vez (máx. 10.000). Retorna totais de inseridos, atualizados e ignorados.',
      inputSchema: {
        contacts: z
          .array(
            z.object({
              name: z.string().max(100).optional().default(''),
              phone: z.string().min(1).describe('Telefone no formato E.164'),
              email: z.string().email().optional().nullable(),
              tags: z.array(z.string()).max(20).optional(),
              custom_fields: z.record(z.string(), z.any()).optional(),
            })
          )
          .min(1)
          .max(10000)
          .describe('Lista de contatos a importar'),
      },
    },
    async ({ contacts }) => {
      const res = await fetch(`${baseUrl()}/api/contacts/import`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ contacts }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? body.details ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.contacts.set_custom_field ─────────────────────────────────────────
  server.registerTool(
    'sz.contacts.set_custom_field',
    {
      title: 'Definir campo customizado em bulk',
      description: 'Aplica um campo customizado em múltiplos contatos de uma vez (máx. 5.000).',
      inputSchema: {
        contactIds: z.array(z.string().uuid()).min(1).max(5000),
        key: z
          .string()
          .min(1)
          .max(60)
          .regex(/^[a-z][a-z0-9_]*$/)
          .describe('Nome do campo (snake_case, começa com letra)'),
        value: z.string().min(1).max(500).describe('Valor a aplicar'),
      },
    },
    async (data) => {
      const res = await fetch(`${baseUrl()}/api/contacts/bulk-set-custom-field`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
