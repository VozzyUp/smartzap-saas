/**
 * Leitura da mensagem (status `read` da Meta) move o cartão de "Mensagem enviada" para "Mensagem lida".
 *
 * Regras: só move a partir de "Mensagem enviada" (nunca anda para trás); quadro sem a fase não faz
 * nada; sempre filtrado por tenant_id; idempotente (repetição/ordem trocada não duplica nada);
 * preserva moved_at e next_followup_index (o relógio do follow-up não reinicia); nunca lança.
 */
import { getSupabaseAdmin } from '@/lib/supabase'
import { listStages, moveCard } from '@/lib/kanban'
import { findReadStage, findSentStage } from '@/lib/kanban-stage-names'

type CardRow = { id: string; board_id: string; stage_id: string; automation_paused?: boolean | null }
type StageRow = { id: string; name: string; position: number }

export interface ReadStageDeps {
  listCards: (tenantId: string, contactId: string) => Promise<CardRow[]>
  listStages: (tenantId: string, boardId: string) => Promise<StageRow[]>
  moveCard: (
    tenantId: string,
    cardId: string,
    params: { stageId: string; position: number; preserveFollowupClock?: boolean }
  ) => Promise<unknown>
}

const defaultDeps: ReadStageDeps = {
  listCards: async (tenantId, contactId) => {
    const admin = getSupabaseAdmin()
    if (!admin) return []
    const { data, error } = await admin
      .from('kanban_cards')
      .select('id, board_id, stage_id, automation_paused')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
    if (error) throw error
    return (data as CardRow[]) ?? []
  },
  listStages: (tenantId, boardId) => listStages(tenantId, boardId) as Promise<StageRow[]>,
  moveCard,
}

export async function moveCardsToReadStage(
  tenantId: string,
  contactId: string,
  deps: ReadStageDeps = defaultDeps
): Promise<{ moved: number }> {
  let moved = 0
  const cards = await deps.listCards(tenantId, contactId)
  for (const card of cards) {
    try {
      if (card.automation_paused) continue
      const stages = await deps.listStages(tenantId, card.board_id)
      const readStage = findReadStage(stages)
      const sentStage = findSentStage(stages)
      if (!readStage || !sentStage) continue
      if (card.stage_id !== sentStage.id) continue // só a partir de "Mensagem enviada"
      if (readStage.position <= sentStage.position) continue // nunca para trás
      await deps.moveCard(tenantId, card.id, { stageId: readStage.id, position: 0, preserveFollowupClock: true })
      moved += 1
    } catch (err) {
      console.error('[Kanban] Falha ao mover cartão para "Mensagem lida" (ignorada):', { tenantId, cardId: card.id, err })
    }
  }
  return { moved }
}

export interface ReadReceiptDeps extends ReadStageDeps {
  findContactId: (tenantId: string, messageId: string) => Promise<string | null>
}

/** Acha o contato dono da mensagem de saída (campanha ou inbox), sempre dentro do tenant. */
async function findContactIdForMessage(tenantId: string, messageId: string): Promise<string | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null

  const { data: cc } = await admin
    .from('campaign_contacts')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('message_id', messageId)
    .limit(1)
    .maybeSingle()
  const fromCampaign = (cc as { contact_id?: string | null } | null)?.contact_id
  if (fromCampaign) return fromCampaign

  const { data: msg } = await admin
    .from('inbox_messages')
    .select('conversation_id')
    .eq('tenant_id', tenantId)
    .eq('whatsapp_message_id', messageId)
    .limit(1)
    .maybeSingle()
  const conversationId = (msg as { conversation_id?: string | null } | null)?.conversation_id
  if (!conversationId) return null

  const { data: conv } = await admin
    .from('inbox_conversations')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('id', conversationId)
    .limit(1)
    .maybeSingle()
  return (conv as { contact_id?: string | null } | null)?.contact_id ?? null
}

/** Ponto de entrada do webhook (status `read`). Best-effort: nunca lança. */
export async function handleReadReceiptForFunnel(
  tenantId: string,
  messageId: string,
  deps: ReadReceiptDeps = { ...defaultDeps, findContactId: findContactIdForMessage }
): Promise<void> {
  try {
    const contactId = await deps.findContactId(tenantId, messageId)
    if (!contactId) return
    await moveCardsToReadStage(tenantId, contactId, deps)
  } catch (err) {
    console.error('[Kanban] Falha ao tratar leitura de mensagem no funil (ignorada):', { tenantId, err })
  }
}
