// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const store = new Map<string, string>()
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    get: vi.fn(async (t: string, k: string) => store.get(`${t}:${k}`) ?? null),
    set: vi.fn(async (t: string, k: string, v: string) => void store.set(`${t}:${k}`, v)),
  },
  contactDb: {
    getByPhone: vi.fn(async () => ({ id: 'c1' })),
    add: vi.fn(async () => ({ id: 'c2' })),
  },
}))
const applyMock = vi.fn(async () => 'created')
vi.mock('@/lib/ai/funnel-classifier', () => ({
  resolveFunnelContext: vi.fn(async () => ({
    boardId: 'b1',
    boardName: 'Funil',
    stages: [{ id: 's1', name: 'Cliente' }],
    currentStageName: null,
  })),
  applyFunnelClassification: (...a: any[]) => applyMock(...(a as [])),
}))

import { POST } from './route'
import { buildInboundToken } from '@/lib/integrations/lead-event'

function call(body: unknown, token?: string) {
  return POST(
    new NextRequest('http://x/api/integrations/lead-event', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/integrations/lead-event', () => {
  let token: string
  beforeEach(() => {
    store.clear()
    applyMock.mockClear()
    const t = buildInboundToken('tenant-a')
    token = t.token
    store.set('tenant-a:integration_inbound_token', t.hash)
  })

  it('401 sem token ou com token inválido', async () => {
    expect((await call({ phone: '11999998888', event: 'x' })).status).toBe(401)
    expect((await call({ phone: '11999998888', event: 'x' }, token + 'z')).status).toBe(401)
    expect(applyMock).not.toHaveBeenCalled()
  })

  it('422 para corpo inválido', async () => {
    const res = await call({ event: 'x' }, token)
    expect(res.status).toBe(422)
  })

  it('200 e aplica a fase no tenant do token', async () => {
    const res = await call({ phone: '11999998888', event: 'subscribed', stage: 'Cliente' }, token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, action: 'created', stage: 'Cliente' })
    expect(applyMock.mock.calls[0]?.[0]).toBe('tenant-a')
  })

  it('404 quando a fase não existe', async () => {
    const res = await call({ phone: '11999998888', event: 'x', stage: 'Nada' }, token)
    expect(res.status).toBe(404)
  })
})
