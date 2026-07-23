import { describe, it, expect, vi, beforeEach } from 'vitest'

const contactsSingleMock = vi.fn()
const campaignContactsMaybeSingleMock = vi.fn()
const supabaseAdminMock = {
  from: (table: string) => {
    if (table === 'contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: contactsSingleMock }) }) }) }
    }
    if (table === 'campaign_contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: campaignContactsMaybeSingleMock }) }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  },
}
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => supabaseAdminMock,
}))

vi.mock('@/lib/phone-formatter', () => ({ normalizePhoneNumber: (p: string) => p }))

const getOrCreateConversationMock = vi.fn()
const createMessageMock = vi.fn()
const updateConversationMock = vi.fn()
const findMessageByWhatsAppIdMock = vi.fn()
vi.mock('./inbox-db', () => ({
  inboxDb: {
    getOrCreateConversation: (...a: unknown[]) => getOrCreateConversationMock(...a),
    createMessage: (...a: unknown[]) => createMessageMock(...a),
    updateConversation: (...a: unknown[]) => updateConversationMock(...a),
    findMessageByWhatsAppId: (...a: unknown[]) => findMessageByWhatsAppIdMock(...a),
  },
  isHumanModeExpired: vi.fn(() => false),
  switchToBotMode: vi.fn(),
  findConversationByPhoneLightweight: vi.fn(),
}))

const cancelDebounceMock = vi.fn()

vi.mock('@upstash/qstash', () => ({ Client: class { publishJSON = vi.fn() } }))
vi.mock('@/lib/redis', () => ({ redis: null }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.vsmart.com' }))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ cancelDebounce: (...a: unknown[]) => cancelDebounceMock(...a) }))
vi.mock('@/lib/whatsapp-send', () => ({ sendWhatsAppMessage: vi.fn() }))
const triggerAutomationEventMock = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  recordInboundActivity: vi.fn(),
  triggerAutomationEvent: (...a: unknown[]) => triggerAutomationEventMock(...a),
  detectQuoteKeyword: vi.fn(),
}))

import { handleOutboundMessageEcho } from './inbox-webhook'

describe('handleOutboundMessageEcho — coexistência (mensagem enviada pelo app do WhatsApp Business)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contactsSingleMock.mockResolvedValue({ data: { id: 'contact_1' } })
    campaignContactsMaybeSingleMock.mockResolvedValue({ data: null })
    findMessageByWhatsAppIdMock.mockResolvedValue(null)
    getOrCreateConversationMock.mockResolvedValue({ id: 'conv_1' })
    createMessageMock.mockResolvedValue({ id: 'msg_1' })
  })

  it('persiste a mensagem como outbound na conversa do cliente (telefone = to)', async () => {
    const result = await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.echo1',
      to: '5511999999999',
      type: 'text',
      text: 'Já resolvi seu pedido!',
      timestamp: '1700000000',
      phoneNumberId: 'pn_1',
    })

    expect(getOrCreateConversationMock).toHaveBeenCalledWith(
      'tenant_1', '5511999999999', 'contact_1', undefined, 'pn_1'
    )
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant_1',
        conversation_id: 'conv_1',
        direction: 'outbound',
        content: 'Já resolvi seu pedido!',
        message_type: 'text',
        whatsapp_message_id: 'wamid.echo1',
        delivery_status: 'sent',
      })
    )
    expect(result).toEqual({ conversationId: 'conv_1', messageId: 'msg_1' })
    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_1', 'message_sent', 'manual')
  })

  it('funciona mesmo sem contato cadastrado (contactId undefined) e não dispara automação de Kanban sem contato', async () => {
    contactsSingleMock.mockResolvedValueOnce({ data: null })

    await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.echo2',
      to: '5511988888888',
      type: 'text',
      text: 'Oi!',
    })

    expect(getOrCreateConversationMock).toHaveBeenCalledWith(
      'tenant_1', '5511988888888', undefined, undefined, undefined
    )
    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
  })

  it('tipo revoke/edit (edição/apagar mensagem do app): não persiste como mensagem nova, mas não lança erro', async () => {
    const result = await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.echo3',
      to: '5511999999999',
      type: 'revoke',
      text: '',
    })

    expect(createMessageMock).not.toHaveBeenCalled()
    expect(updateConversationMock).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('atendente respondeu pelo app do celular numa conversa em modo bot: desativa a IA (muda pra modo humano) e cancela debounce pendente', async () => {
    getOrCreateConversationMock.mockResolvedValueOnce({ id: 'conv_1', mode: 'bot' })

    await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.echo4',
      to: '5511999999999',
      type: 'text',
      text: 'Já te atendo por aqui!',
    })

    expect(updateConversationMock).toHaveBeenCalledWith('tenant_1', 'conv_1', { mode: 'human' })
    expect(cancelDebounceMock).toHaveBeenCalledWith('conv_1')
  })

  it('conversa já em modo humano: não escreve de novo no banco (evita update redundante a cada echo)', async () => {
    getOrCreateConversationMock.mockResolvedValueOnce({ id: 'conv_1', mode: 'human' })

    await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.echo5',
      to: '5511999999999',
      type: 'text',
      text: 'Mais uma mensagem',
    })

    expect(updateConversationMock).not.toHaveBeenCalled()
  })

  it('wamid já persistido no inbox (IA/resposta manual/campanha via workflow já registrou): não duplica mensagem, não dispara Kanban nem desativa a IA', async () => {
    findMessageByWhatsAppIdMock.mockResolvedValueOnce({ id: 'msg_existing', conversation_id: 'conv_1' })

    const result = await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.already-known',
      to: '5511999999999',
      type: 'text',
      text: 'Mensagem que já é nossa',
    })

    expect(result).toEqual({ conversationId: 'conv_1', messageId: 'msg_existing' })
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(getOrCreateConversationMock).not.toHaveBeenCalled()
    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
    expect(updateConversationMock).not.toHaveBeenCalled()
  })

  it('wamid bate com campaign_contacts.message_id (campanha disparada direto, sem sync prévio pro inbox): persiste a mensagem, mas não dispara automação de Kanban nem desativa a IA', async () => {
    campaignContactsMaybeSingleMock.mockResolvedValueOnce({ data: { id: 'cc_1' } })
    getOrCreateConversationMock.mockResolvedValueOnce({ id: 'conv_1', mode: 'bot' })

    const result = await handleOutboundMessageEcho({
      tenantId: 'tenant_1',
      messageId: 'wamid.campaign-1',
      to: '5511999999999',
      type: 'text',
      text: 'Template de campanha',
    })

    expect(createMessageMock).toHaveBeenCalled()
    expect(result).toEqual({ conversationId: 'conv_1', messageId: 'msg_1' })
    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
    expect(updateConversationMock).not.toHaveBeenCalled()
    expect(cancelDebounceMock).not.toHaveBeenCalled()
  })
})
