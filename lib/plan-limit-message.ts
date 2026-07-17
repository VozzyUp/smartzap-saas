const LABELS: Record<string, string> = {
  contacts: 'contatos',
  templates: 'templates',
  campaigns: 'campanhas por mês',
  whatsapp_numbers: 'número de WhatsApp',
}

export function formatPlanLimit(body: { error?: string; dimension?: string; limit?: number | null; current?: number }): string {
  const label = body.dimension ? LABELS[body.dimension] : undefined
  if (!label || body.limit == null) {
    return 'Você atingiu o limite do seu plano. Faça upgrade para continuar.'
  }
  const plural = body.limit === 1 ? label.replace('números', 'número') : label
  return `Seu plano permite até ${body.limit} ${plural}. Faça upgrade para criar mais.`
}
