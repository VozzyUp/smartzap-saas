import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { syncCampaignTemplateToInbox, sendMessage } from './inbox-service'

// Mock das dependências do inbox-db
vi.mock('./inbox-db', () => ({
  findMessageByWhatsAppId: vi.fn(),
  getOrCreateConversation: vi.fn(),
  createMessage: vi.fn(),
  getConversationById: vi.fn(),
  updateMessageDeliveryStatus: vi.fn(),
  updateConversation: vi.fn(),
}))

vi.mock('@/lib/whatsapp-send', () => ({
  sendWhatsAppMessage: vi.fn(),
}))

vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentialsForNumber: vi.fn(),
}))

const triggerAutomationEventMock = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  triggerAutomationEvent: (...a: unknown[]) => triggerAutomationEventMock(...a),
}))

const cancelDebounceMock = vi.fn()
vi.mock('@/lib/ai/agents/chat-agent', () => ({
  cancelDebounce: (...a: unknown[]) => cancelDebounceMock(...a),
}))

import {
  findMessageByWhatsAppId,
  getOrCreateConversation,
  createMessage,
  getConversationById,
  updateMessageDeliveryStatus,
  updateConversation,
} from './inbox-db'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { getWhatsAppCredentialsForNumber } from '@/lib/whatsapp-credentials'

const mockFindMessageByWhatsAppId = findMessageByWhatsAppId as Mock
const mockGetOrCreateConversation = getOrCreateConversation as Mock
const mockCreateMessage = createMessage as Mock
const mockGetConversationById = getConversationById as Mock
const mockUpdateMessageDeliveryStatus = updateMessageDeliveryStatus as Mock
const mockUpdateConversation = updateConversation as Mock
const mockSendWhatsAppMessage = sendWhatsAppMessage as Mock
const mockGetWhatsAppCredentialsForNumber = getWhatsAppCredentialsForNumber as Mock

describe('syncCampaignTemplateToInbox', () => {
  const baseParams = {
    tenantId: 'tenant_123',
    phone: '+5511999999999',
    contactId: 'contact_123',
    whatsappMessageId: 'wamid.123456',
    templateName: 'promo_black_friday',
    templatePreviewText: '📋 *Template: promo_black_friday*\n\nOlá João!',
    resolvedValues: {
      body: [{ key: '1', text: 'João' }],
    },
    campaignId: 'campaign_123',
    template: {
      id: 'tpl_1',
      name: 'promo_black_friday',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      content: '',
      preview: '',
      lastUpdated: new Date().toISOString(),
      components: [
        { type: 'BODY', text: 'Olá {{1}}!' },
      ],
    } as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Suprime console.log e console.warn durante os testes
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deve criar mensagem no inbox quando não existe duplicata', async () => {
    // Arrange
    mockFindMessageByWhatsAppId.mockResolvedValue(null)
    mockGetOrCreateConversation.mockResolvedValue({
      id: 'conv_123',
      phone: '+5511999999999',
      status: 'open',
    })
    mockCreateMessage.mockResolvedValue({
      id: 'msg_123',
      conversation_id: 'conv_123',
      direction: 'outbound',
      content: baseParams.templatePreviewText,
      message_type: 'template',
    })

    // Act
    const result = await syncCampaignTemplateToInbox(baseParams)

    // Assert
    expect(result).toBe('msg_123')
    expect(mockFindMessageByWhatsAppId).toHaveBeenCalledWith('wamid.123456')
    expect(mockGetOrCreateConversation).toHaveBeenCalledWith(
      'tenant_123',
      '+5511999999999',
      'contact_123',
      undefined
    )
    expect(mockCreateMessage).toHaveBeenCalledWith({
      tenant_id: 'tenant_123',
      conversation_id: 'conv_123',
      direction: 'outbound',
      content: baseParams.templatePreviewText,
      message_type: 'template',
      whatsapp_message_id: 'wamid.123456',
      delivery_status: 'sent',
      payload: expect.objectContaining({
        type: 'campaign_template',
        campaign_id: 'campaign_123',
        template_name: 'promo_black_friday',
        template_language: 'pt_BR',
        resolved_values: baseParams.resolvedValues,
      }),
    })
  })

  it('deve retornar ID existente quando mensagem já existe (idempotência)', async () => {
    // Arrange
    mockFindMessageByWhatsAppId.mockResolvedValue({
      id: 'msg_existing',
      whatsapp_message_id: 'wamid.123456',
    })

    // Act
    const result = await syncCampaignTemplateToInbox(baseParams)

    // Assert
    expect(result).toBe('msg_existing')
    expect(mockGetOrCreateConversation).not.toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('deve retornar null e não propagar erro quando findMessageByWhatsAppId falha', async () => {
    // Arrange
    mockFindMessageByWhatsAppId.mockRejectedValue(new Error('Database connection failed'))

    // Act
    const result = await syncCampaignTemplateToInbox(baseParams)

    // Assert
    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[inbox-sync] Failed to sync'),
      expect.stringContaining('Database connection failed')
    )
  })

  it('deve retornar null e não propagar erro quando createMessage falha', async () => {
    // Arrange
    mockFindMessageByWhatsAppId.mockResolvedValue(null)
    mockGetOrCreateConversation.mockResolvedValue({
      id: 'conv_123',
      phone: '+5511999999999',
      status: 'open',
    })
    mockCreateMessage.mockRejectedValue(new Error('Insert failed'))

    // Act
    const result = await syncCampaignTemplateToInbox(baseParams)

    // Assert
    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[inbox-sync] Failed to sync'),
      expect.stringContaining('Insert failed')
    )
  })

  it('deve funcionar quando contactId é null', async () => {
    // Arrange
    const paramsWithNullContact = {
      ...baseParams,
      contactId: null,
    }
    mockFindMessageByWhatsAppId.mockResolvedValue(null)
    mockGetOrCreateConversation.mockResolvedValue({
      id: 'conv_123',
      phone: '+5511999999999',
      status: 'open',
    })
    mockCreateMessage.mockResolvedValue({
      id: 'msg_123',
      conversation_id: 'conv_123',
    })

    // Act
    const result = await syncCampaignTemplateToInbox(paramsWithNullContact)

    // Assert
    expect(result).toBe('msg_123')
    expect(mockGetOrCreateConversation).toHaveBeenCalledWith(
      'tenant_123',
      '+5511999999999',
      undefined, // contactId null vira undefined
      undefined
    )
  })

  it('deve incluir synced_at no payload', async () => {
    // Arrange
    const beforeTest = new Date().toISOString()
    mockFindMessageByWhatsAppId.mockResolvedValue(null)
    mockGetOrCreateConversation.mockResolvedValue({
      id: 'conv_123',
      phone: '+5511999999999',
      status: 'open',
    })
    mockCreateMessage.mockResolvedValue({
      id: 'msg_123',
      conversation_id: 'conv_123',
    })

    // Act
    await syncCampaignTemplateToInbox(baseParams)

    // Assert
    const createMessageCall = mockCreateMessage.mock.calls[0][0]
    expect(createMessageCall.payload.synced_at).toBeDefined()
    expect(new Date(createMessageCall.payload.synced_at).getTime()).toBeGreaterThanOrEqual(
      new Date(beforeTest).getTime()
    )
  })
})

describe('sendMessage (Fase 4: reply pelo numero da conversa)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockCreateMessage.mockResolvedValue({ id: 'msg_1' })
    mockSendWhatsAppMessage.mockResolvedValue({ messageId: 'wamid_1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('conversa com whatsapp_number_id -> getWhatsAppCredentialsForNumber(tenantId, numero_da_conversa)', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_1',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_2',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_2',
      businessAccountId: 'ba_2',
      accessToken: 'tok_2',
    })

    await sendMessage('tenant_1', 'conv_1', 'oi')

    expect(mockGetWhatsAppCredentialsForNumber).toHaveBeenCalledWith('tenant_1', 'pn_2')
    expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({
        to: '5511999999999',
        credentials: { phoneNumberId: 'pn_2', businessAccountId: 'ba_2', accessToken: 'tok_2' },
      })
    )
  })

  it('conversa antiga sem whatsapp_number_id -> passa null (delega ao numero ativo/legado)', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_2',
      phone: '5511988888888',
      whatsapp_number_id: null,
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })

    await sendMessage('tenant_1', 'conv_2', 'oi')

    expect(mockGetWhatsAppCredentialsForNumber).toHaveBeenCalledWith('tenant_1', null)
  })

  it('sem credenciais para o numero da conversa -> lanca erro', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_3',
      phone: '5511977777777',
      whatsapp_number_id: 'pn_x',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue(null)

    await expect(sendMessage('tenant_1', 'conv_3', 'oi')).rejects.toThrow(
      'WhatsApp credentials not configured'
    )
  })

  it('envio manual com sucesso: dispara automação de Kanban message_sent com o contact_id da conversa', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_4',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_1',
      contact_id: 'contact_4',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })

    await sendMessage('tenant_1', 'conv_4', 'oi')

    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_4', 'message_sent', 'manual')
  })

  it('conversa sem contact_id: não dispara automação', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_5',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_1',
      contact_id: null,
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })

    await sendMessage('tenant_1', 'conv_5', 'oi')

    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
  })

  it('falha no envio (whatsappResult.error): não dispara automação', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_6',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_1',
      contact_id: 'contact_6',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })
    mockSendWhatsAppMessage.mockResolvedValueOnce({ error: 'falha no envio' })

    await sendMessage('tenant_1', 'conv_6', 'oi')

    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
  })

  it('atendente responde manualmente pelo V-Smart numa conversa em modo bot: desativa a IA (muda pra modo humano) e cancela debounce pendente', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_7',
      tenant_id: 'tenant_1',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_1',
      contact_id: 'contact_7',
      mode: 'bot',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })

    await sendMessage('tenant_1', 'conv_7', 'oi')

    expect(mockUpdateConversation).toHaveBeenCalledWith('tenant_1', 'conv_7', { mode: 'human' })
    expect(cancelDebounceMock).toHaveBeenCalledWith('conv_7')
  })

  it('conversa já em modo humano: não escreve de novo no banco (evita update redundante a cada mensagem)', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_8',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_1',
      contact_id: 'contact_8',
      mode: 'human',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })

    await sendMessage('tenant_1', 'conv_8', 'oi')

    expect(mockUpdateConversation).not.toHaveBeenCalled()
  })

  it('falha no envio: não muda o modo da conversa', async () => {
    mockGetConversationById.mockResolvedValue({
      id: 'conv_9',
      phone: '5511999999999',
      whatsapp_number_id: 'pn_1',
      contact_id: 'contact_9',
      mode: 'bot',
    })
    mockGetWhatsAppCredentialsForNumber.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok_1',
    })
    mockSendWhatsAppMessage.mockResolvedValueOnce({ error: 'falha no envio' })

    await sendMessage('tenant_1', 'conv_9', 'oi')

    expect(mockUpdateConversation).not.toHaveBeenCalled()
  })
})
