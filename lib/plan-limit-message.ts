const LABELS: Record<string, string> = {
  contacts: 'contatos',
  templates: 'templates',
  campaigns: 'campanhas por mês',
  whatsapp_numbers: 'número de WhatsApp',
}

export interface PlanLimitBody {
  error?: string
  dimension?: string
  limit?: number | null
  current?: number
}

/**
 * Detecta se um erro (lançado por `lib/api`'s `ApiError` ou qualquer erro com
 * `status`/`body` anexados manualmente) representa um 403 de limite de plano
 * (`{ error: 'plan_limit', dimension, limit, current } `).
 * Retorna o body estruturado para uso com `formatPlanLimit`, ou `null` caso não seja.
 */
export function getPlanLimitBody(error: unknown): PlanLimitBody | null {
  const e = error as { status?: number; body?: PlanLimitBody } | null | undefined
  if (e && typeof e === 'object' && e.status === 403 && e.body && (e.body as PlanLimitBody).error === 'plan_limit') {
    return e.body as PlanLimitBody
  }
  return null
}

export function formatPlanLimit(body: PlanLimitBody): string {
  const label = body.dimension ? LABELS[body.dimension] : undefined
  if (!label || body.limit == null) {
    return 'Você atingiu o limite do seu plano. Faça upgrade para continuar.'
  }
  const plural = body.limit === 1 ? label.replace('números', 'número') : label
  return `Seu plano permite até ${body.limit} ${plural}. Faça upgrade para criar mais.`
}
