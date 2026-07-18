import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const rpcMock = vi.fn()
const updateEqEqMock = vi.fn()
const inboxMessagesFromMock = vi.fn(() => ({
  update: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: updateEqEqMock,
    })),
  })),
}))

const supabaseAdminMock = {
  rpc: rpcMock,
  from: (table: string) => inboxMessagesFromMock(table),
}

const getSupabaseAdminMock = vi.fn(() => supabaseAdminMock)
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdminMock(...args),
}))

const publishJSONMock = vi.fn()
vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON(...args: unknown[]) {
      return publishJSONMock(...args)
    }
  },
}))

vi.mock('@/lib/redis', () => ({ redis: null }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.example.com' }))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ cancelDebounce: vi.fn() }))
vi.mock('@/lib/whatsapp-send', () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock('@/lib/phone-formatter', () => ({ normalizePhoneNumber: (p: string) => p }))
vi.mock('./inbox-db', () => ({
  inboxDb: {
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    createMessage: vi.fn(),
  },
  isHumanModeExpired: vi.fn(() => false),
  switchToBotMode: vi.fn(),
  findConversationByPhoneLightweight: vi.fn(),
}))

const storeInboundMediaMock = vi.fn()
vi.mock('@/lib/inbox/inbox-media', () => ({
  storeInboundMedia: (...args: unknown[]) => storeInboundMediaMock(...args),
}))

const getWhatsAppCredentialsMock = vi.fn()
vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentials: (...args: unknown[]) => getWhatsAppCredentialsMock(...args),
}))

import { handleInboundMessage } from './inbox-webhook'

const RPC_RESULT_BASE = {
  conversation_id: 'conv_1',
  message_id: 'msg_1',
  is_new_conversation: false,
  conversation_status: 'open',
  // 'human' sem expiração e sem 'bot' evita disparar triggerAIProcessing
  // (fora do escopo deste teste, que é sobre persistência/enqueue de mídia).
  conversation_mode: 'human',
  ai_agent_id: null,
  human_mode_expires_at: null,
  automation_paused_until: null,
}

describe('handleInboundMessage — mídia recebida (Fase 5A / T4)', () => {
  const originalQstashToken = process.env.QSTASH_TOKEN

  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseAdminMock.mockReturnValue(supabaseAdminMock)
    updateEqEqMock.mockResolvedValue({ data: null, error: null })
    rpcMock.mockResolvedValue({ data: RPC_RESULT_BASE, error: null })
  })

  afterEach(() => {
    if (originalQstashToken === undefined) delete process.env.QSTASH_TOKEN
    else process.env.QSTASH_TOKEN = originalQstashToken
  })

  it('mensagem image com caption: persiste message_type=image, content=caption via RPC, marca media_status=pending e enfileira no QStash', async () => {
    process.env.QSTASH_TOKEN = 'qstash_test_token'

    const result = await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_1',
      from: '5511999999999',
      type: 'image',
      text: '',
      mediaId: 'mid_1',
      mediaMime: 'image/jpeg',
      caption: 'oi',
      phoneNumberId: 'pn_1',
    })

    // RPC recebe o content correto (a legenda, não o placeholder "[image]")
    // e o message_type mapeado.
    expect(rpcMock).toHaveBeenCalledWith(
      'process_inbound_message',
      expect.objectContaining({
        p_content: 'oi',
        p_message_type: 'image',
      })
    )

    // UPDATE pós-RPC escopado por tenant+id marca pending + metadados de mídia
    // (a RPC não conhece media_mime/media_filename/media_status).
    expect(inboxMessagesFromMock).toHaveBeenCalledWith('inbox_messages')
    expect(updateEqEqMock).toHaveBeenCalled()

    // Enfileira o download via QStash (fora do caminho síncrono do webhook).
    expect(publishJSONMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://app.example.com/api/inbox/media/ingest',
        body: { tenantId: 'tenant_1', conversationId: 'conv_1', messageId: 'msg_1', mediaId: 'mid_1' },
      })
    )
    expect(storeInboundMediaMock).not.toHaveBeenCalled()

    expect(result).toEqual({ conversationId: 'conv_1', messageId: 'msg_1', triggeredAI: false })
  })

  it('mensagem de texto (sem mídia): não marca pending nem enfileira', async () => {
    process.env.QSTASH_TOKEN = 'qstash_test_token'

    await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_2',
      from: '5511999999999',
      type: 'text',
      text: 'olá',
      phoneNumberId: 'pn_1',
    })

    expect(rpcMock).toHaveBeenCalledWith(
      'process_inbound_message',
      expect.objectContaining({ p_content: 'olá', p_message_type: 'text' })
    )
    expect(updateEqEqMock).not.toHaveBeenCalled()
    expect(publishJSONMock).not.toHaveBeenCalled()
  })

  it('sem QSTASH_TOKEN (dev): faz fallback inline via storeInboundMedia com o access_token do tenant', async () => {
    delete process.env.QSTASH_TOKEN
    getWhatsAppCredentialsMock.mockResolvedValue({
      phoneNumberId: 'pn_1',
      businessAccountId: 'waba_1',
      accessToken: 'meta_token_1',
    })
    storeInboundMediaMock.mockResolvedValue(undefined)

    await handleInboundMessage({
      tenantId: 'tenant_1',
      messageId: 'wamid_3',
      from: '5511999999999',
      type: 'document',
      text: '',
      mediaId: 'mid_doc_1',
      mediaMime: 'application/pdf',
      mediaFilename: 'contrato.pdf',
      caption: null,
      phoneNumberId: 'pn_1',
    })

    expect(publishJSONMock).not.toHaveBeenCalled()
    expect(getWhatsAppCredentialsMock).toHaveBeenCalledWith('tenant_1')
    expect(storeInboundMediaMock).toHaveBeenCalledWith({
      tenantId: 'tenant_1',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      mediaId: 'mid_doc_1',
      accessToken: 'meta_token_1',
    })
  })
})
