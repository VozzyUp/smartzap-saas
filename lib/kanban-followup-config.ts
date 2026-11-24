/**
 * Associação regra de follow-up -> modelo (template) aprovado da Meta.
 *
 * Guardada na tabela `settings` (chave `kanban_followup_templates`, por tenant) para
 * não exigir migração: JSON { [stageId]: Array<FollowupTemplateConfig | null> }, onde o
 * índice do array é a posição da regra no estágio (o editor salva todas as regras de uma vez).
 */

import { settingsDb } from '@/lib/supabase-db'

export const FOLLOWUP_TEMPLATES_SETTING_KEY = 'kanban_followup_templates'

export type FollowupTemplateConfig = {
  templateName: string
  language: string
  /** Valores das variáveis {{1}}, {{2}}... do corpo, na ordem. Aceita "{{nome}}" (primeiro nome) e texto fixo. */
  bodyParams?: string[]
  /** true = envia o modelo mesmo dentro da janela de 24 h (contato que nunca respondeu). */
  alwaysSend?: boolean
}

export type FollowupTemplateMap = Record<string, Array<FollowupTemplateConfig | null>>

/** Valida/normaliza um valor vindo de fora (API ou JSON salvo). Retorna null se inválido. */
export function normalizeFollowupTemplate(raw: unknown): FollowupTemplateConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const templateName = typeof r.templateName === 'string' ? r.templateName.trim() : ''
  if (!templateName) return null
  const language = typeof r.language === 'string' && r.language.trim() ? r.language.trim() : 'pt_BR'
  const out: FollowupTemplateConfig = { templateName, language }
  if (Array.isArray(r.bodyParams)) {
    out.bodyParams = r.bodyParams.map((p) => String(p ?? '').slice(0, 1000))
  }
  if (r.alwaysSend === true) out.alwaysSend = true
  return out
}

export async function getFollowupTemplateMap(tenantId: string): Promise<FollowupTemplateMap> {
  try {
    const raw = await settingsDb.get(tenantId, FOLLOWUP_TEMPLATES_SETTING_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: FollowupTemplateMap = {}
    for (const [stageId, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) map[stageId] = list.map(normalizeFollowupTemplate)
    }
    return map
  } catch (e) {
    console.error('[Kanban] Falha ao ler kanban_followup_templates:', { tenantId, e })
    return {}
  }
}

export async function getFollowupTemplate(
  tenantId: string,
  stageId: string,
  ruleIndex: number
): Promise<FollowupTemplateConfig | null> {
  const map = await getFollowupTemplateMap(tenantId)
  return map[stageId]?.[ruleIndex] ?? null
}

/** Substitui as associações do estágio (índice = posição da regra). Lista sem nenhum modelo remove o estágio. */
export async function saveStageFollowupTemplates(
  tenantId: string,
  stageId: string,
  configs: Array<FollowupTemplateConfig | null>
): Promise<void> {
  const map = await getFollowupTemplateMap(tenantId)
  if (configs.some(Boolean)) map[stageId] = configs
  else delete map[stageId]
  await settingsDb.set(tenantId, FOLLOWUP_TEMPLATES_SETTING_KEY, JSON.stringify(map))
}
