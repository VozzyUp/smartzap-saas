import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  single: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }))

import {
  createLabel,
  createQuickReply,
  getConversationById,
  getLabels,
  getMessagesByConversation,
  getQuickReplies,
} from './inbox-db'

describe('inbox database tenant isolation', () => {
  const tenantId = 'tenant-a'
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    select: mocks.select,
    eq: mocks.eq,
    order: mocks.order,
    limit: mocks.limit,
    single: mocks.single,
    insert: mocks.insert,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSupabaseAdmin.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue(query)
    mocks.select.mockReturnValue(query)
    mocks.eq.mockReturnValue(query)
    mocks.insert.mockReturnValue(query)
    mocks.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
    mocks.order.mockReturnValue(query)
    mocks.limit.mockResolvedValue({ data: [], error: null })
  })

  it('busca uma conversa somente dentro do tenant', async () => {
    await getConversationById(tenantId, 'conversation-b')

    expect(mocks.eq).toHaveBeenCalledWith('tenant_id', tenantId)
    expect(mocks.eq).toHaveBeenCalledWith('id', 'conversation-b')
  })

  it('limita as mensagens da conversa ao tenant', async () => {
    await getMessagesByConversation(tenantId, 'conversation-b')

    expect(mocks.eq).toHaveBeenCalledWith('tenant_id', tenantId)
    expect(mocks.eq).toHaveBeenCalledWith('conversation_id', 'conversation-b')
  })

  it('lista e cria labels no tenant autenticado', async () => {
    await getLabels(tenantId)
    mocks.single.mockResolvedValueOnce({ data: { id: 'label-1' }, error: null })
    await createLabel(tenantId, { name: 'VIP' })

    expect(mocks.eq).toHaveBeenCalledWith('tenant_id', tenantId)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: tenantId,
      name: 'VIP',
    }))
  })

  it('lista e cria respostas rápidas no tenant autenticado', async () => {
    await getQuickReplies(tenantId)
    mocks.single.mockResolvedValueOnce({ data: { id: 'reply-1' }, error: null })
    await createQuickReply(tenantId, { title: 'Olá', content: 'Como posso ajudar?' })

    expect(mocks.eq).toHaveBeenCalledWith('tenant_id', tenantId)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: tenantId,
      title: 'Olá',
    }))
  })
})
