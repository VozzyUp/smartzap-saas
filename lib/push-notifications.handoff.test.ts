import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a), generateVAPIDKeys: vi.fn() },
}))
vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }))

const eqCalls: Array<[string, unknown]> = []
let subsResult: { data: unknown; error: unknown } = { data: [], error: null }
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => {
          eqCalls.push([`${table}.${c}`, v])
          return chain
        },
        then: (res: (v: unknown) => unknown) => res(subsResult),
      }
      return chain
    },
  }),
}))

import { sendHandoffNotification } from './push-notifications'

beforeEach(() => {
  vi.clearAllMocks()
  eqCalls.length = 0
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  sendNotification.mockResolvedValue({})
  subsResult = { data: [{ endpoint: 'e1', keys: { p256dh: 'a', auth: 'b' } }, { endpoint: 'e2', keys: { p256dh: 'a', auth: 'b' } }], error: null }
})

describe('sendHandoffNotification', () => {
  it('envia só para as subscriptions do tenant', async () => {
    const r = await sendHandoffNotification('tenant-1', { conversationId: 'conv1', contactLabel: 'Maria', reason: 'quer falar com humano' })
    expect(eqCalls).toContainEqual(['push_subscriptions.tenant_id', 'tenant-1'])
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(r).toEqual({ sent: 2, failed: 0 })
    const payload = JSON.parse(sendNotification.mock.calls[0][1])
    expect(payload.title).toMatch(/atendente|humano/i)
    expect(payload.body).toContain('Maria')
    expect(payload.data.conversationId).toBe('conv1')
  })

  it('sem subscriptions: 0 enviados', async () => {
    subsResult = { data: [], error: null }
    expect(await sendHandoffNotification('t', { conversationId: 'c', contactLabel: 'x' })).toEqual({ sent: 0, failed: 0 })
  })

  it('falha do push é best-effort: não lança', async () => {
    sendNotification.mockRejectedValue(new Error('push down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await sendHandoffNotification('t', { conversationId: 'c', contactLabel: 'x' })
    expect(r.failed).toBe(2)
    spy.mockRestore()
  })

  it('erro ao ler subscriptions: não lança', async () => {
    subsResult = { data: null, error: { message: 'x' } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await sendHandoffNotification('t', { conversationId: 'c', contactLabel: 'x' })).toEqual({ sent: 0, failed: 0 })
    spy.mockRestore()
  })
})
