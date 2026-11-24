import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a), generateVAPIDKeys: vi.fn() },
}))

const deletes: Array<[string, unknown]> = []
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      let isDelete = false
      const chain: any = {
        select: () => chain,
        delete: () => { isDelete = true; return chain },
        eq: (c: string, v: unknown) => { if (isDelete) deletes.push([c, v]); return chain },
        then: (res: (v: unknown) => unknown) =>
          res(isDelete ? { error: null } : { data: [{ endpoint: 'e1', keys: { p256dh: 'a', auth: 'b' } }], error: null }),
      }
      return chain
    },
  }),
}))

import { broadcastPushNotificationToTenant } from './push-notifications'

beforeEach(() => {
  deletes.length = 0
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
})

describe('subscription expirada', () => {
  it('remove com client admin filtrando endpoint e tenant', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    const r = await broadcastPushNotificationToTenant('t1', { title: 'a', body: 'b' })
    expect(r).toEqual({ sent: 0, failed: 1 })
    expect(deletes).toContainEqual(['endpoint', 'e1'])
    expect(deletes).toContainEqual(['tenant_id', 't1'])
  })
})
