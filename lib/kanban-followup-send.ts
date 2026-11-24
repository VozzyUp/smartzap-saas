/**
 * Decisão e preparo do envio de follow-up do Kanban.
 *
 * A Meta só aceita texto livre dentro de 24 h da última mensagem RECEBIDA do contato.
 * Fora da janela, só modelo (template) aprovado. Aqui ficam as regras puras + o preparo do modelo.
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveVarValue } from '@/lib/whatsapp/template-contract'
import type { FollowupTemplateConfig } from '@/lib/kanban-followup-config'

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000

export function isInside24hWindow(now: Date, lastInboundAt: Date | null): boolean {
  if (!lastInboundAt || Number.isNaN(lastInboundAt.getTime())) return false
  return now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS
}

export type FollowupSendDecision =
  | { mode: 'text' }
  | { mode: 'template' }
  | { mode: 'skip'; reason: 'outside_24h_window_no_template' }

export function decideFollowupSend(input: {
  now: Date
  lastInboundAt: Date | null
  template: FollowupTemplateConfig | null
}): FollowupSendDecision {
  if (input.template?.alwaysSend) return { mode: 'template' }
  if (isInside24hWindow(input.now, input.lastInboundAt)) return { mode: 'text' }
  if (input.template) return { mode: 'template' }
  return { mode: 'skip', reason: 'outside_24h_window_no_template' }
}

export function firstName(name: string | null | undefined): string | undefined {
  const n = String(name ?? '').trim().split(/\s+/)[0]
  return n || undefined
}

function bodyVariableNumbers(bodyText: string): number[] {
  const nums = new Set<number>()
  for (const m of bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]))
  return Array.from(nums).sort((a, b) => a - b)
}

export type PreparedTemplateSend =
  | { ok: true; templateName: string; language: string; bodyParams: string[]; renderedText: string }
  | {
      ok: false
      reason:
        | 'template_not_found'
        | 'template_not_approved'
        | 'template_named_params_unsupported'
        | 'template_variable_mismatch'
    }

/**
 * Confere o modelo no banco (sincronizado e APROVADO) e resolve os valores das variáveis.
 * "{{nome}}" vira o primeiro nome do contato (reserva "Cliente"); qualquer outro texto é fixo.
 * Sem bodyParams definidos: modelo com 1 variável recebe o primeiro nome; sem variável não leva parâmetro.
 */
export async function prepareFollowupTemplate(
  tenantId: string,
  cfg: FollowupTemplateConfig,
  contact: { name?: string | null; phone: string }
): Promise<PreparedTemplateSend> {
  const admin = getSupabaseAdmin()
  const { data } = admin
    ? await admin
        .from('templates')
        .select('status, parameter_format, components')
        .eq('tenant_id', tenantId)
        .eq('name', cfg.templateName)
        .eq('language', cfg.language)
        .maybeSingle()
    : { data: null }

  if (!data) return { ok: false, reason: 'template_not_found' }
  const row = data as { status?: string | null; parameter_format?: string | null; components?: any }
  if (String(row.status ?? '').toUpperCase() !== 'APPROVED') return { ok: false, reason: 'template_not_approved' }
  if (row.parameter_format === 'named') return { ok: false, reason: 'template_named_params_unsupported' }

  const components: any[] = Array.isArray(row.components) ? row.components : []
  const body = components.find((c) => String(c?.type).toUpperCase() === 'BODY')
  const bodyText: string = typeof body?.text === 'string' ? body.text : ''
  const nums = bodyVariableNumbers(bodyText)

  const raw = cfg.bodyParams ?? (nums.length > 0 ? ['{{nome}}'] : [])
  const lead = { phone: contact.phone, name: firstName(contact.name) }
  const params = raw.map((p) => resolveVarValue(p, lead))

  if (params.length !== nums.length || params.some((p) => !p)) {
    return { ok: false, reason: 'template_variable_mismatch' }
  }

  const renderedText = bodyText
    ? bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? '')
    : `[Modelo: ${cfg.templateName}]`

  return { ok: true, templateName: cfg.templateName, language: cfg.language, bodyParams: params, renderedText }
}
