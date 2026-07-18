import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let ctxMock: any = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ctxMock),
}))

const setActiveMock = vi.fn(async () => {})
const mirrorMock = vi.fn(async () => {})
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  setActiveWhatsAppNumber: (...a: any[]) => setActiveMock(...a),
  mirrorActiveToSettings: (...a: any[]) => mirrorMock(...a),
}))

import { POST } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/whatsapp-numbers/[id]/activate', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    setActiveMock.mockClear(); mirrorMock.mockClear()
  })

  it('401 sem sessão', async () => {
    ctxMock = null
    const req = new NextRequest('http://localhost/api/whatsapp-numbers/pn_2/activate', { method: 'POST' })
    const res = await POST(req, makeParams('pn_2'))
    expect(res.status).toBe(401)
  })

  it('200 e chama setActiveWhatsAppNumber + mirrorActiveToSettings escopado ao tenant', async () => {
    const req = new NextRequest('http://localhost/api/whatsapp-numbers/pn_2/activate', { method: 'POST' })
    const res = await POST(req, makeParams('pn_2'))
    expect(res.status).toBe(200)
    expect(setActiveMock).toHaveBeenCalledWith('t1', 'pn_2')
    expect(mirrorMock).toHaveBeenCalledWith('t1')
  })

  it('404 quando setActiveWhatsAppNumber lança (número não pertence ao tenant)', async () => {
    setActiveMock.mockRejectedValueOnce(new Error('whatsapp number pn_x não encontrado para o tenant t1'))
    const req = new NextRequest('http://localhost/api/whatsapp-numbers/pn_x/activate', { method: 'POST' })
    const res = await POST(req, makeParams('pn_x'))
    expect(res.status).toBe(404)
    expect(mirrorMock).not.toHaveBeenCalled()
  })
})
