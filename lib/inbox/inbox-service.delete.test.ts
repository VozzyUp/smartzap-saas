import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  removeConversation: vi.fn(),
  updateConversation: vi.fn(),
  removeCardsForContact: vi.fn(),
  contactLookup: vi.fn(),
  contactEqs: [] as Array<[string, unknown]>,
}))

vi.mock('./inbox-db', () => ({
  getConversationById: (...a: unknown[]) => m.getConversationById(...a),
  removeConversation: (...a: unknown[]) => m.removeConversation(...a),
  updateConversation: (...a: unknown[]) => m.updateConversation(...a),
}))
vi.mock('@/lib/kanban', () => ({ removeCardsForContact: (...a: unknown[]) => m.removeCardsForContact(...a) }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          m.contactEqs.push([k, v])
          return chain
        },
        maybeSingle: async () => ({ data: m.contactLookup(), error: null }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/whatsapp-send', () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock('@/lib/whatsapp-credentials', () => ({ getWhatsAppCredentialsForNumber: vi.fn() }))
vi.mock('@/lib/kanban-automation', () => ({ triggerAutomationEvent: vi.fn() }))
vi.mock('@/lib/ai/agents/chat-agent', () => ({ cancelDebounce: vi.fn() }))

import { deleteConversation, patchConversation } from './inbox-service'

describe('deleteConversation apaga o cartão do funil (F18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.contactEqs.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getConversationById.mockResolvedValue({ id: 'cv1', phone: '+5511999999999', contact_id: 'ct1' })
    m.removeConversation.mockResolvedValue(undefined)
    m.removeCardsForContact.mockResolvedValue(1)
    m.contactLookup.mockReturnValue(null)
  })

  it('apaga a conversa e os cartões do contato, filtrando por tenant', async () => {
    await deleteConversation('t1', 'cv1')
    expect(m.removeConversation).toHaveBeenCalledWith('t1', 'cv1')
    expect(m.removeCardsForContact).toHaveBeenCalledWith('t1', 'ct1')
  })

  it('sem contact_id: resolve o contato pelo telefone no mesmo tenant', async () => {
    m.getConversationById.mockResolvedValue({ id: 'cv1', phone: '+5511999999999', contact_id: null })
    m.contactLookup.mockReturnValue({ id: 'ct9' })
    await deleteConversation('t1', 'cv1')
    expect(m.contactEqs).toContainEqual(['tenant_id', 't1'])
    expect(m.contactEqs).toContainEqual(['phone', '+5511999999999'])
    expect(m.removeCardsForContact).toHaveBeenCalledWith('t1', 'ct9')
  })

  it('sem contato resolvível: apaga só a conversa', async () => {
    m.getConversationById.mockResolvedValue({ id: 'cv1', phone: '+5511999999999', contact_id: null })
    await deleteConversation('t1', 'cv1')
    expect(m.removeConversation).toHaveBeenCalled()
    expect(m.removeCardsForContact).not.toHaveBeenCalled()
  })

  it('falha ao apagar o cartão não impede (nem derruba) a exclusão da conversa', async () => {
    m.removeCardsForContact.mockRejectedValue(new Error('db'))
    await expect(deleteConversation('t1', 'cv1')).resolves.toBeUndefined()
    expect(m.removeConversation).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('falha ao ler a conversa antes: ainda apaga a conversa', async () => {
    m.getConversationById.mockRejectedValue(new Error('db'))
    await deleteConversation('t1', 'cv1')
    expect(m.removeConversation).toHaveBeenCalledWith('t1', 'cv1')
    expect(m.removeCardsForContact).not.toHaveBeenCalled()
  })

  it('se a exclusão da conversa falha, o cartão NÃO é apagado e o erro sobe', async () => {
    m.removeConversation.mockRejectedValue(new Error('fail'))
    await expect(deleteConversation('t1', 'cv1')).rejects.toThrow('fail')
    expect(m.removeCardsForContact).not.toHaveBeenCalled()
  })

  it('fechar a conversa (status closed) não mexe no cartão', async () => {
    m.updateConversation.mockResolvedValue({ id: 'cv1', status: 'closed' })
    await patchConversation('t1', 'cv1', { status: 'closed' } as any)
    expect(m.removeCardsForContact).not.toHaveBeenCalled()
    expect(m.removeConversation).not.toHaveBeenCalled()
  })
})
