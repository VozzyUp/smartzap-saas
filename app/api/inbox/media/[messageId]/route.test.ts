import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getTenantContextMock = vi.fn()
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: (...a: any[]) => getTenantContextMock(...a),
}))

const getSignedMediaUrlMock = vi.fn()
vi.mock('@/lib/inbox/inbox-media', () => ({
  getSignedMediaUrl: (...a: any[]) => getSignedMediaUrlMock(...a),
}))

import { GET } from './route'

function makeParams(messageId: string) {
  return { params: Promise.resolve({ messageId }) }
}
const req = () => new NextRequest('http://localhost/api/inbox/media/m1')

describe('GET /api/inbox/media/[messageId]', () => {
  beforeEach(() => {
    getTenantContextMock.mockReset()
    getSignedMediaUrlMock.mockReset()
  })

  it('401 sem sessão', async () => {
    getTenantContextMock.mockResolvedValueOnce(null)
    const res = await GET(req(), makeParams('m1'))
    expect(res.status).toBe(401)
    expect(getSignedMediaUrlMock).not.toHaveBeenCalled()
  })

  it('404 quando a mídia não é do tenant / não existe', async () => {
    getTenantContextMock.mockResolvedValueOnce({ tenantId: 't1' })
    getSignedMediaUrlMock.mockResolvedValueOnce(null)
    const res = await GET(req(), makeParams('m_de_outro'))
    expect(res.status).toBe(404)
    expect(getSignedMediaUrlMock).toHaveBeenCalledWith('t1', 'm_de_outro')
  })

  it('302 redireciona para a signed URL quando existe', async () => {
    getTenantContextMock.mockResolvedValueOnce({ tenantId: 't1' })
    getSignedMediaUrlMock.mockResolvedValueOnce('https://signed.example/wa-inbox-media/x?token=abc')
    const res = await GET(req(), makeParams('m1'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://signed.example/wa-inbox-media/x?token=abc')
  })
})
