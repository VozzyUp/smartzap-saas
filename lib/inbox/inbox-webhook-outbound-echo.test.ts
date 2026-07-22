import { describe, it, expect, vi, beforeEach } from 'vitest'

const contactsSingleMock = vi.fn()
const supabaseAdminMock = {
  from: (table: string) => {
    if (table === 'contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: contactsSingleMock }) }) }) }
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
vi.mock('./inbox-db', () => ({
  inboxDb: {
    getOrCreateConversation: (...a: unknown[]) => getOrCreateConversationMock(...a),
    createMessage: (...a: unknown[]) => createMessageMock(...a),
  },
  isHumanModeExpired: vi.fn(() => false),
  switchToBotMode: vi.fn(),
  findConversationByPhoneLightweight: vi.fn(),
}))

vi.mock('@upstash/qstash', () => ({ Client: class { publishJSON = vi.fn() } }))
vi.mock('@/lib/redis', () => ({ redis: null }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.vsmart.com' }))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ cancelDebounce: vi.fn() }))
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
    expect(result).toBeNull()
  })
})
