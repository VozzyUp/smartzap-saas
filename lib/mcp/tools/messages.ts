import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ok, err } from '@/lib/mcp/helpers'
import { getAppUrl } from '@/lib/app-url'

const baseUrl = () => getAppUrl()
const apiKey = () => process.env.SMARTZAP_API_KEY ?? ''

export function registerMessagesTools(server: McpServer) {
  // ─── sz.messages.send_test ───────────────────────────────────────────────
  server.registerTool(
    'sz.messages.send_test',
    {
      title: 'Enviar mensagem de teste',
      description:
        'Envia uma mensagem de texto direta para um número WhatsApp. Útil para testar credenciais e conectividade.',
      inputSchema: {
        phone: z.string().describe('Número no formato E.164: +5511999999999'),
        message: z.string().max(4096).describe('Texto da mensagem'),
      },
    },
    async ({ phone, message }) => {
      const res = await fetch(`${baseUrl()}/api/messages/send-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey(),
        },
        body: JSON.stringify({ phone, message }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.messages.send_template ───────────────────────────────────────────
  server.registerTool(
    'sz.messages.send_template',
    {
      title: 'Enviar template WhatsApp',
      description:
        'Envia um template HSM para um número específico. Use para testes de template antes de criar campanha.',
      inputSchema: {
        phone: z.string().describe('Número no formato E.164: +5511999999999'),
        templateName: z.string().describe('Nome exato do template'),
        variables: z
          .array(z.string())
          .optional()
          .describe('Variáveis de corpo na ordem {{1}}, {{2}}...'),
        headerVariable: z.string().optional().describe('Variável do header (texto ou URL de mídia)'),
      },
    },
    async ({ phone, templateName, variables, headerVariable }) => {
      const res = await fetch(`${baseUrl()}/api/messages/send-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey(),
        },
        body: JSON.stringify({
          phone,
          templateName,
          variables,
          headerVariable,
          useTemplate: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
