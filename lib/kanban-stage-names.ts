/**
 * Identificação de fases do funil pelo NOME (o quadro é editável pelo dono; não há coluna de papel).
 * Funções puras, sem dependências, usadas pela leitura de mensagem (Mensagem enviada -> Mensagem lida)
 * e pelo follow-up (Mensagem lida herda as regras de Mensagem enviada).
 */

export function normalizeStageName(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function isReadStageName(name: unknown): boolean {
  return normalizeStageName(name) === 'mensagem lida'
}

export function isSentStageName(name: unknown): boolean {
  return normalizeStageName(name) === 'mensagem enviada'
}

type NamedStage = { id: string; name: string }

export function findReadStage<T extends NamedStage>(stages: T[]): T | null {
  return stages.find((s) => isReadStageName(s.name)) ?? null
}

export function findSentStage<T extends NamedStage>(stages: T[]): T | null {
  return stages.find((s) => isSentStageName(s.name)) ?? null
}

/**
 * Se o cartão está em "Mensagem lida", devolve o id de "Mensagem enviada" do mesmo quadro: as duas
 * são a mesma etapa de espera, então as regras de follow-up de "Mensagem enviada" continuam valendo.
 * Qualquer outro caso devolve null.
 */
export function resolveFollowupStageId(stages: NamedStage[], currentStageId: string): string | null {
  const current = stages.find((s) => s.id === currentStageId)
  if (!current || !isReadStageName(current.name)) return null
  return findSentStage(stages)?.id ?? null
}
