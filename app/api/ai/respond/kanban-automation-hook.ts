import { triggerAutomationEvent } from '@/lib/kanban-automation'

/**
 * Dispara a automação de Kanban depois que a IA efetivamente enviou uma
 * resposta no WhatsApp: sempre 'message_sent', e 'quote_detected' se a IA
 * sinalizou (via tool-call, campo detectedQuoteRequest) que o cliente pediu
 * orçamento nesta troca. Best-effort — nunca derruba o worker de resposta da IA.
 */
export async function triggerKanbanAutomationForAIReply(
  tenantId: string,
  contactId: string | null | undefined,
  detectedQuoteRequest: boolean | undefined
): Promise<void> {
  if (!contactId) return

  try {
    await triggerAutomationEvent(tenantId, contactId, 'message_sent', 'ai')
    if (detectedQuoteRequest) {
      await triggerAutomationEvent(tenantId, contactId, 'quote_detected', 'ai')
    }
  } catch (e) {
    console.warn('[AI-RESPOND] Falha na automação de Kanban (best-effort):', e)
  }
}
