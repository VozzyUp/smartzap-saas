/**
 * Origens (phone_suppressions.source) de supressão.
 *
 * - Opt-out: o contato pediu para parar (palavra-chave, IA, erro de opt-out da Meta)
 *   ou o dono bloqueou à mão. O robô NUNCA responde a esses.
 * - Automática por falha de entrega (auto_failure_policy): protege campanhas em massa
 *   (número inválido/sem WhatsApp), mas NÃO é um pedido do contato; quem escreve
 *   primeiro para a empresa deve ser atendido pelo robô.
 *
 * Campanhas e follow-ups continuam respeitando TODAS as supressões.
 */

export const OPT_OUT_SUPPRESSION_SOURCES = ['inbound_keyword', 'ai_detected', 'meta_opt_out_error'] as const

/** Supressões que NÃO são pedido do contato (não silenciam o robô). */
export const NON_OPT_OUT_SUPPRESSION_SOURCES = ['auto_failure_policy'] as const

/**
 * true se a supressão deve silenciar o robô. Origem desconhecida ou vazia
 * (bloqueio manual, legado) conta como opt-out: na dúvida, não escrever.
 */
export function isOptOutSuppressionSource(source: string | null | undefined): boolean {
  if (!source) return true
  return !(NON_OPT_OUT_SUPPRESSION_SOURCES as readonly string[]).includes(source)
}
