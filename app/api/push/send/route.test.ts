import { describe, it, expect, vi, beforeEach } from 'vitest'

const toTenant = vi.fn()
vi.mock('@/lib/push-notifications', () => ({
  broadcastPushNotificationToTenant: (...a: unknown[]) => toTenant(...a),
  sendNewMessageNotification: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}))

import { POST } from './route'

const req = (body: unknown, auth = 'Bearer k') =>
  new Request('http://x/api/push/send', { method: 'POST', body: JSON.stringify(body), headers: { authorization: auth } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMARTZAP_ADMIN_KEY = 'k'
  toTenant.mockResolvedValue({ sent: 1, failed: 0 })
})

describe('POST /api/push/send', () => {
  it('401 sem chave', async () => {
    expect((await POST(req({ body: 'x', tenantId: 't1' }, 'Bearer errada'))).status).toBe(401)
  })
  it('400 sem tenantId (nunca faz broadcast global)', async () => {
    const res = await POST(req({ body: 'x' }))
    expect(res.status).toBe(400)
    expect(toTenant).not.toHaveBeenCalled()
  })
  it('envia só para o tenant informado', async () => {
    const res = await POST(req({ body: 'oi', tenantId: 't1' }))
    expect(res.status).toBe(200)
    expect(toTenant.mock.calls[0][0]).toBe('t1')
  })
})
