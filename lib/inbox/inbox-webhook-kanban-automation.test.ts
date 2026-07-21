import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpcMock = vi.fn()
const contactsSingleMock = vi.fn()
const supabaseAdminMock = {
  rpc: rpcMock,
  from: (table: string) => {
    if (table === 'contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: contactsSingleMock }) }) }) }
    }
    if (table === 'inbox_messages') {
      return { update: () => ({ eq: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  },
}
const getSupabaseAdminMock = vi.fn(() => supabaseAdminMock)
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdminMock(...args),
}))

vi.mock('@upstash/qstash', () => ({ Client: class { publishJSON = vi.fn() } }))
vi.mock('@/lib/redis', () => ({ redis: null }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.example.com' }))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ cancelDebounce: vi.fn() }))
vi.mock('@/lib/whatsapp-send', () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock('@/lib/phone-formatter', () => ({ normalizePhoneNumber: (p: string) => p }))
vi.mock('./inbox-db', () => ({
  inboxDb: { createConversation: vi.fn(), updateConversation: vi.fn(), createMessage: vi.fn() },
  isHumanModeExpired: vi.fn(() => false),
  switchToBotMode: vi.fn(),
  findConversationByPhoneLightweight: vi.fn(),
}))
vi.mock('@/lib/inbox/inbox-media', () => ({ storeInboundMedia: vi.fn() }))
vi.mock('@/lib/whatsapp-credentials', () => ({ getWhatsAppCredentials: vi.fn() }))

const recordInboundActivityMock = vi.fn()
const triggerAutomationEventMock = vi.fn()
const detectQuoteKeywordMock = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  recordInboundActivity: (...a: unknown[]) => recordInboundActivityMock(...a),
  triggerAutomationEvent: (...a: unknown[]) => triggerAutomationEventMock(...a),
  detectQuoteKeyword: (...a: unknown[]) => detectQuoteKeywordMock(...a),
}))

import { handleInboundMessage } from './inbox-webhook'

const RPC_RESULT_BASE = {
  conversation_id: 'conv_1',
  message_id: 'msg_1',
  is_new_conversation: false,
  conversation_status: 'open',
  conversation_mode: 'human',
  ai_agent_id: null,
  human_mode_expires_at: null,
  automation_paused_until: null,
}

describe('handleInboundMessage — automação de Kanban por resposta do cliente', () => {
  const originalQstashToken = process.env.QSTASH_TOKEN

  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseAdminMock.mockReturnValue(supabaseAdminMock)
    rpcMock.mockResolvedValue({ data: RPC_RESULT_BASE, error: null })
    contactsSingleMock.mockResolvedValue({ data: { id: 'contact_1' }, error: null })
    recordInboundActivityMock.mockResolvedValue(undefined)
    triggerAutomationEventMock.mockResolvedValue(undefined)
    detectQuoteKeywordMock.mockResolvedValue(false)
    delete process.env.QSTASH_TOKEN
  })

  afterEach(() => {
    if (originalQstashToken === undefined) delete process.env.QSTASH_TOKEN
    else process.env.QSTASH_TOKEN = originalQstashToken
  })

  it('registra atividade e dispara o evento client_replied com o contact_id resolvido', async () => {
    await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_1',
      from: '5511999999999',
      type: 'text',
      text: 'oi, ainda estou pensando',
      phoneNumberId: 'pn_1',
    })

    expect(recordInboundActivityMock).toHaveBeenCalledWith('tenant_1', 'contact_1')
    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_1', 'client_replied', 'system')
  })

  it('detecta palavra-chave de orçamento e dispara o evento quote_detected', async () => {
    detectQuoteKeywordMock.mockResolvedValueOnce(true)

    await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_2',
      from: '5511999999999',
      type: 'text',
      text: 'quanto custa o serviço?',
      phoneNumberId: 'pn_1',
    })

    expect(detectQuoteKeywordMock).toHaveBeenCalledWith('tenant_1', 'quanto custa o serviço?')
    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_1', 'quote_detected', 'keyword')
  })

  it('sem contato resolvido (telefone desconhecido): não tenta automação', async () => {
    contactsSingleMock.mockResolvedValueOnce({ data: null, error: null })

    await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_3',
      from: '5511888888888',
      type: 'text',
      text: 'oi',
      phoneNumberId: 'pn_1',
    })

    expect(recordInboundActivityMock).not.toHaveBeenCalled()
    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
  })

  it('automação falhando não derruba o webhook (best-effort)', async () => {
    triggerAutomationEventMock.mockRejectedValueOnce(new Error('boom'))

    const result = await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_4',
      from: '5511999999999',
      type: 'text',
      text: 'oi',
      phoneNumberId: 'pn_1',
    })

    expect(result).toEqual({ conversationId: 'conv_1', messageId: 'msg_1', triggeredAI: false })
  })
})
