/**
 * "Ao enviar, colocar o contato na fase": cria o cartão do contato no quadro de funil quando a
 * Meta aceita o envio da campanha. Guardado em `templateVariables.funnelStage` ({ boardId, stageId }).
 *
 * Regras: só CRIA (addCardToBoard falha com card_exists se já houver cartão no quadro, então nunca
 * duplica nem move para trás); falha nunca lança; sempre escopado por tenant_id.
 */
import { addCardToBoard } from '@/lib/kanban'

export interface FunnelStageTarget {
  boardId: string
  stageId: string
}

export function parseFunnelStage(templateVariables: unknown): FunnelStageTarget | null {
  const fs = (templateVariables as any)?.funnelStage
  if (!fs || typeof fs !== 'object') return null
  const boardId = typeof fs.boardId === 'string' ? fs.boardId.trim() : ''
  const stageId = typeof fs.stageId === 'string' ? fs.stageId.trim() : ''
  return boardId && stageId ? { boardId, stageId } : null
}

export interface EnsureCardsDeps {
  addCard?: (tenantId: string, boardId: string, contactId: string, stageId: string) => Promise<unknown>
  logger?: (msg: string, meta: unknown) => void
}

export async function ensureFunnelCardsForSent(
  tenantId: string,
  target: FunnelStageTarget | null,
  contactIds: string[],
  deps: EnsureCardsDeps = {}
): Promise<{ created: number; existing: number; failed: number }> {
  const out = { created: 0, existing: 0, failed: 0 }
  if (!target) return out
  const ids = Array.from(new Set(contactIds.map((c) => String(c || '').trim()).filter(Boolean)))
  const addCard = deps.addCard ?? ((t, b, c, s) => addCardToBoard(t, b, c, s))
  const log = deps.logger ?? ((msg, meta) => console.warn(msg, meta))

  for (const contactId of ids) {
    try {
      await addCard(tenantId, target.boardId, contactId, target.stageId)
      out.created += 1
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'card_exists') {
        out.existing += 1
      } else {
        out.failed += 1
        log('[campaign-funnel] falha ao criar cartão (envio não é afetado):', {
          tenantId,
          contactId,
          boardId: target.boardId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return out
}
