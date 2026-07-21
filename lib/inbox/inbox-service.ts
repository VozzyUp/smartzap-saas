/**
 * Inbox Service Layer
 * T017: Business logic for inbox operations
 */

import {
  getConversations,
  getConversationById,
  getOrCreateConversation,
  updateConversation,
  removeConversation,
  markConversationAsRead,
  getMessagesByConversation,
  createMessage,
  findMessageByWhatsAppId,
  updateMessageDeliveryStatus,
  getLabels,
  createLabel,
  deleteLabel,
  addLabelToConversation,
  removeLabelFromConversation,
  getQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  type ConversationFilters,
  type MessageFilters,
} from './inbox-db'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { getWhatsAppCredentialsForNumber } from '@/lib/whatsapp-credentials'
import { triggerAutomationEvent } from '@/lib/kanban-automation'
import type {
  InboxConversation,
  InboxMessage,
  InboxLabel,
  InboxQuickReply,
  UpdateInboxConversationDTO,
  CreateInboxLabelDTO,
  CreateInboxQuickReplyDTO,
  ConversationMode,
  ConversationPriority,
  Template,
} from '@/types'
import type { ResolvedTemplateValues } from '@/lib/whatsapp/template-contract'

// =============================================================================
// Conversation Service
// =============================================================================

export async function listConversations(tenantId: string, filters: ConversationFilters = {}) {
  return getConversations(tenantId, filters)
}

export async function getConversation(tenantId: string, id: string) {
  return getConversationById(tenantId, id)
}

export async function findOrCreateConversation(
  tenantId: string,
  phone: string,
  contactId?: string,
  aiAgentId?: string
) {
  return getOrCreateConversation(tenantId, phone, contactId, aiAgentId)
}

export async function patchConversation(
  tenantId: string,
  id: string,
  updates: UpdateInboxConversationDTO
) {
  return updateConversation(tenantId, id, updates)
}

export async function closeConversation(tenantId: string, id: string) {
  return updateConversation(tenantId, id, { status: 'closed' })
}

export async function reopenConversation(tenantId: string, id: string) {
  return updateConversation(tenantId, id, { status: 'open' })
}

export async function setConversationMode(tenantId: string, id: string, mode: ConversationMode) {
  return updateConversation(tenantId, id, { mode })
}

export async function setConversationPriority(
  tenantId: string,
  id: string,
  priority: ConversationPriority
) {
  return updateConversation(tenantId, id, { priority })
}

export async function markAsRead(tenantId: string, conversationId: string) {
  return markConversationAsRead(tenantId, conversationId)
}

export async function deleteConversation(tenantId: string, id: string) {
  return removeConversation(tenantId, id)
}

// =============================================================================
// Message Service
// =============================================================================

export async function listMessages(
  tenantId: string,
  conversationId: string,
  filters: MessageFilters = {}
) {
  return getMessagesByConversation(tenantId, conversationId, filters)
}

/**
 * Send a message to a conversation
 * This handles both persisting the message and sending via WhatsApp
 */
export async function sendMessage(
  tenantId: string,
  conversationId: string,
  content: string,
  messageType: 'text' | 'template' = 'text',
  templateName?: string,
  templateParams?: Record<string, string[]>
): Promise<InboxMessage> {
  // Get conversation to get phone number
  const conversation = await getConversationById(tenantId, conversationId)
  if (!conversation) {
    throw new Error('Conversation not found')
  }

  // Get WhatsApp credentials — responde pelo número da própria conversa (Fase 4);
  // conversas antigas (whatsapp_number_id null) caem no número ativo/legado.
  const credentials = await getWhatsAppCredentialsForNumber(
    tenantId,
    conversation.whatsapp_number_id ?? null
  )
  if (!credentials) {
    throw new Error('WhatsApp credentials not configured')
  }

  // Send via WhatsApp
  let whatsappResult: { messageId?: string; error?: string }

  try {
    if (messageType === 'template' && templateName) {
      // Send template message
      whatsappResult = await sendWhatsAppMessage(tenantId, {
        to: conversation.phone,
        type: 'template',
        templateName,
        templateParams,
        credentials,
      })
    } else {
      // Send text message
      whatsappResult = await sendWhatsAppMessage(tenantId, {
        to: conversation.phone,
        type: 'text',
        text: content,
        credentials,
      })
    }
  } catch (error) {
    whatsappResult = {
      error: error instanceof Error ? error.message : 'Failed to send message',
    }
  }

  // Persist the message
  const message = await createMessage({
    tenant_id: tenantId,
    conversation_id: conversationId,
    direction: 'outbound',
    content,
    message_type: messageType,
    whatsapp_message_id: whatsappResult.messageId,
  })

  // Update delivery status based on send result
  if (whatsappResult.error) {
    await updateMessageDeliveryStatus(message.id, 'failed')
  } else if (whatsappResult.messageId) {
    await updateMessageDeliveryStatus(whatsappResult.messageId, 'sent')
  }

  // Automação de Kanban: só dispara em resposta 1:1 de atendente humano
  // realmente enviada (não em falha), nunca em disparo de campanha (função
  // separada) — best-effort, não pode derrubar o envio da mensagem.
  if (!whatsappResult.error && conversation.contact_id) {
    try {
      await triggerAutomationEvent(tenantId, conversation.contact_id, 'message_sent', 'manual')
    } catch (e) {
      console.warn('[Inbox] Falha na automação de Kanban (best-effort):', e)
    }
  }

  return message
}

/**
 * Persist an inbound message from webhook
 */
export async function persistInboundMessage(
  tenantId: string,
  phone: string,
  content: string,
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document' = 'text',
  whatsappMessageId?: string,
  mediaUrl?: string,
  payload?: Record<string, unknown>,
  contactId?: string
): Promise<{ conversation: InboxConversation; message: InboxMessage }> {
  // Find or create conversation
  const conversation = await findOrCreateConversation(tenantId, phone, contactId)

  // Create message
  const message = await createMessage({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    direction: 'inbound',
    content,
    message_type: messageType,
    whatsapp_message_id: whatsappMessageId,
    media_url: mediaUrl,
    payload,
  })

  // Refresh conversation to get updated counters
  const updatedConversation = await getConversationById(tenantId, conversation.id)

  return {
    conversation: updatedConversation!,
    message,
  }
}

/**
 * Handle delivery status update from webhook
 */
export async function handleDeliveryStatusUpdate(
  whatsappMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed'
) {
  return updateMessageDeliveryStatus(whatsappMessageId, status)
}

// =============================================================================
// Label Service
// =============================================================================

export async function listLabels(tenantId: string) {
  return getLabels(tenantId)
}

export async function createNewLabel(tenantId: string, dto: CreateInboxLabelDTO) {
  return createLabel(tenantId, dto)
}

export async function removeLabel(tenantId: string, id: string) {
  return deleteLabel(tenantId, id)
}

export async function assignLabel(tenantId: string, conversationId: string, labelId: string) {
  return addLabelToConversation(tenantId, conversationId, labelId)
}

export async function unassignLabel(tenantId: string, conversationId: string, labelId: string) {
  return removeLabelFromConversation(tenantId, conversationId, labelId)
}

// =============================================================================
// Quick Replies Service
// =============================================================================

export async function listQuickReplies(tenantId: string) {
  return getQuickReplies(tenantId)
}

export async function createNewQuickReply(tenantId: string, dto: CreateInboxQuickReplyDTO) {
  return createQuickReply(tenantId, dto)
}

export async function updateExistingQuickReply(
  tenantId: string,
  id: string,
  dto: Partial<CreateInboxQuickReplyDTO>
) {
  return updateQuickReply(tenantId, id, dto)
}

export async function removeQuickReply(tenantId: string, id: string) {
  return deleteQuickReply(tenantId, id)
}

// =============================================================================
// Automation Control
// =============================================================================

/**
 * Pause automation for a conversation
 */
export async function pauseAutomation(
  tenantId: string,
  conversationId: string,
  minutes: number,
  pausedBy?: string
): Promise<InboxConversation> {
  const pauseUntil = new Date()
  pauseUntil.setMinutes(pauseUntil.getMinutes() + minutes)

  return updateConversation(tenantId, conversationId, {
    mode: 'human',
    // @ts-expect-error - These fields exist but aren't in the DTO
    automation_paused_until: pauseUntil.toISOString(),
    automation_paused_by: pausedBy || 'operator',
  })
}

/**
 * Resume automation for a conversation
 */
export async function resumeAutomation(
  tenantId: string,
  conversationId: string
): Promise<InboxConversation> {
  return updateConversation(tenantId, conversationId, {
    mode: 'bot',
    // @ts-expect-error - These fields exist but aren't in the DTO
    automation_paused_until: null,
    automation_paused_by: null,
  })
}

/**
 * Check if automation is paused for a conversation
 */
export async function isAutomationPaused(
  tenantId: string,
  conversationId: string
): Promise<boolean> {
  const conversation = await getConversationById(tenantId, conversationId)
  if (!conversation) return false

  // Check if in human mode
  if (conversation.mode === 'human') return true

  // Check if pause is still active
  if (conversation.automation_paused_until) {
    const pauseUntil = new Date(conversation.automation_paused_until)
    if (pauseUntil > new Date()) {
      return true
    }

    // Pause expired, resume automation
    await resumeAutomation(tenantId, conversationId)
  }

  return false
}

// =============================================================================
// Handoff Service
// =============================================================================

/**
 * Execute handoff to human operator
 */
export async function executeHandoff(
  tenantId: string,
  conversationId: string,
  reason: string,
  summary: string,
  priority: ConversationPriority = 'high'
): Promise<InboxConversation> {
  return updateConversation(tenantId, conversationId, {
    mode: 'human',
    priority,
    // @ts-expect-error - This field exists but isn't in the DTO
    handoff_summary: `**Motivo:** ${reason}\n\n**Resumo:** ${summary}`,
  })
}

// =============================================================================
// Campaign Template Sync
// =============================================================================

export interface SyncCampaignTemplateParams {
  tenantId: string
  phone: string
  contactId: string | null
  whatsappMessageId: string
  templateName: string
  templatePreviewText: string
  resolvedValues: ResolvedTemplateValues
  campaignId: string
  template: Template
}

/**
 * Sincroniza template enviado por campanha com o inbox.
 *
 * Cria uma entrada em inbox_messages para que:
 * 1. A IA tenha contexto do template enviado quando o cliente responder
 * 2. O operador veja o template no histórico visual do inbox
 * 3. Status updates (delivered, read) sejam sincronizados automaticamente
 *    (porque usamos o mesmo whatsapp_message_id da Meta)
 *
 * Características:
 * - Idempotente: verifica se já existe por whatsapp_message_id
 * - Best-effort: catch + log, não propaga erro para não afetar o workflow
 *
 * @returns ID da mensagem criada ou null se já existia/erro
 */
export async function syncCampaignTemplateToInbox(
  params: SyncCampaignTemplateParams
): Promise<string | null> {
  const {
    tenantId,
    phone,
    contactId,
    whatsappMessageId,
    templateName,
    templatePreviewText,
    resolvedValues,
    campaignId,
    template,
  } = params

  try {
    // Idempotência: verifica se já existe mensagem com esse whatsapp_message_id
    const existing = await findMessageByWhatsAppId(whatsappMessageId)
    if (existing) {
      console.log(`[inbox-sync] Message already exists for ${whatsappMessageId}, skipping`)
      return existing.id
    }

    // Busca ou cria conversa para esse telefone
    const conversation = await getOrCreateConversation(
      tenantId,
      phone,
      contactId || undefined,
      undefined // aiAgentId - usar default
    )

    // Cria a mensagem no inbox
    const message = await createMessage({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: 'outbound',
      content: templatePreviewText,
      message_type: 'template',
      whatsapp_message_id: whatsappMessageId,
      delivery_status: 'sent',
      payload: {
        type: 'campaign_template',
        campaign_id: campaignId,
        template_name: templateName,
        template_language: template.language,
        resolved_values: resolvedValues,
        synced_at: new Date().toISOString(),
      },
    })

    console.log(`[inbox-sync] Created inbox message ${message.id} for campaign ${campaignId}`)
    return message.id
  } catch (error) {
    // Best-effort: log e retorna null, não propaga erro
    console.warn(
      `[inbox-sync] Failed to sync template to inbox for ${phone}:`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}
