import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let ctxMock: any = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ctxMock),
}))

const removeMock = vi.fn(async () => {})
const mirrorMock = vi.fn(async () => {})
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  removeWhatsAppNumber: (...a: any[]) => removeMock(...a),
  mirrorActiveToSettings: (...a: any[]) => mirrorMock(...a),
}))

import { DELETE } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('DELETE /api/whatsapp-numbers/[id]', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    removeMock.mockClear(); mirrorMock.mockClear()
  })

  it('401 sem sessão', async () => {
    ctxMock = null
    const req = new NextRequest('http://localhost/api/whatsapp-numbers/pn_2', { method: 'DELETE' })
    const res = await DELETE(req, makeParams('pn_2'))
    expect(res.status).toBe(401)
  })

  it('200 e chama removeWhatsAppNumber + mirrorActiveToSettings escopado ao tenant', async () => {
    const req = new NextRequest('http://localhost/api/whatsapp-numbers/pn_2', { method: 'DELETE' })
    const res = await DELETE(req, makeParams('pn_2'))
    expect(res.status).toBe(200)
    expect(removeMock).toHaveBeenCalledWith('t1', 'pn_2')
    expect(mirrorMock).toHaveBeenCalledWith('t1')
  })

  it('500 quando removeWhatsAppNumber lança', async () => {
    removeMock.mockRejectedValueOnce(new Error('boom'))
    const req = new NextRequest('http://localhost/api/whatsapp-numbers/pn_2', { method: 'DELETE' })
    const res = await DELETE(req, makeParams('pn_2'))
    expect(res.status).toBe(500)
    expect(mirrorMock).not.toHaveBeenCalled()
  })
})
