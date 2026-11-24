import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  broadcast: vi.fn(),
  redisSet: vi.fn(),
  updateConversation: vi.fn(),
  createMessage: vi.fn(),
  redisOn: { v: true },
}))

vi.mock('@/lib/push-notifications', () => ({
  broadcastPushNotificationToTenant: (...a: unknown[]) => m.broadcast(...a),
}))
vi.mock('@/lib/redis', () => ({
  get redis() {
    return m.redisOn.v ? { set: (...a: unknown[]) => m.redisSet(...a) } : null
  },
}))
vi.mock('@/lib/inbox/inbox-db', () => ({
  inboxDb: {
    updateConversation: (...a: unknown[]) => m.updateConversation(...a),
    createMessage: (...a: unknown[]) => m.createMessage(...a),
  },
}))

import { notifyOpsAlert, moveConversationToHumanForOps, __resetOpsAlertMemory } from './ops-alert'

beforeEach(() => {
  vi.clearAllMocks()
  __resetOpsAlertMemory()
  m.redisOn.v = true
  m.broadcast.mockResolvedValue({ sent: 1, failed: 0 })
  m.redisSet.mockResolvedValue('OK')
  m.updateConversation.mockResolvedValue({})
  m.createMessage.mockResolvedValue({})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('notifyOpsAlert', () => {
  it('loga estruturado e envia push ao tenant', async () => {
    await notifyOpsAlert({ tenantId: 't1', conversationId: 'c1', type: 'ai_send_failed', error: new Error('boom') })
    expect(console.error).toHaveBeenCalledWith(
      '[OpsAlert]',
      expect.objectContaining({ tenantId: 't1', conversationId: 'c1', type: 'ai_send_failed', error: 'boom' })
    )
    expect(m.broadcast).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ title: expect.any(String), tag: 'ops-ai_send_failed' })
    )
  })

  it('limite de frequência (Redis): segundo alerta do mesmo tipo/tenant não envia push, mas loga', async () => {
    m.redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null)
    await notifyOpsAlert({ tenantId: 't1', type: 'ai_no_agent' })
    await notifyOpsAlert({ tenantId: 't1', type: 'ai_no_agent' })
    expect(m.broadcast).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledTimes(2)
    expect(m.redisSet).toHaveBeenCalledWith('ops-alert:t1:ai_no_agent', '1', { nx: true, ex: 600 })
  })

  it('tipos e tenants diferentes não se bloqueiam (memória, sem Redis)', async () => {
    m.redisOn.v = false
    await notifyOpsAlert({ tenantId: 't1', type: 'ai_no_agent' })
    await notifyOpsAlert({ tenantId: 't1', type: 'ai_no_agent' })
    await notifyOpsAlert({ tenantId: 't1', type: 'ai_queue_failed' })
    await notifyOpsAlert({ tenantId: 't2', type: 'ai_no_agent' })
    expect(m.broadcast).toHaveBeenCalledTimes(3)
  })

  it('Redis com erro cai para memória', async () => {
    m.redisSet.mockRejectedValue(new Error('redis down'))
    await notifyOpsAlert({ tenantId: 't1', type: 'webhook_error' })
    await notifyOpsAlert({ tenantId: 't1', type: 'webhook_error' })
    expect(m.broadcast).toHaveBeenCalledTimes(1)
  })

  it('nunca lança, mesmo se o push falhar', async () => {
    m.broadcast.mockRejectedValue(new Error('push down'))
    await expect(notifyOpsAlert({ tenantId: 't1', type: 'inbox_save_failed' })).resolves.toBeUndefined()
  })

  it('sem tenantId: só loga', async () => {
    await notifyOpsAlert({ tenantId: null, type: 'webhook_error', error: 'x' })
    expect(m.broadcast).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('loga só a mensagem do erro, truncada', async () => {
    await notifyOpsAlert({ tenantId: 't1', type: 'webhook_error', error: new Error('x'.repeat(500)) })
    const logged = (console.error as any).mock.calls[0][1]
    expect(logged.error.length).toBeLessThanOrEqual(200)
  })
})

describe('moveConversationToHumanForOps', () => {
  it('põe em modo humano e cria nota interna', async () => {
    await moveConversationToHumanForOps('t1', 'c1', 'Sem agente de IA ativo')
    expect(m.updateConversation).toHaveBeenCalledWith('t1', 'c1', { mode: 'human' })
    expect(m.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', conversation_id: 'c1', message_type: 'internal_note' })
    )
  })

  it('nunca lança', async () => {
    m.updateConversation.mockRejectedValue(new Error('db'))
    await expect(moveConversationToHumanForOps('t1', 'c1', 'x')).resolves.toBeUndefined()
  })
})
