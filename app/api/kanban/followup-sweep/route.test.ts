import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const runFollowupSweepMock = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  runFollowupSweep: (...a: unknown[]) => runFollowupSweepMock(...a),
}))

const verifyMock = vi.fn()
const receiverCtor = vi.fn()
vi.mock('@upstash/qstash', () => ({
  Receiver: class {
    constructor(opts: unknown) {
      receiverCtor(opts)
    }
    verify(args: unknown) {
      return verifyMock(args)
    }
  },
}))

import { POST } from './route'

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/kanban/followup-sweep', { method: 'POST', headers, body: '{}' })
}

describe('POST /api/kanban/followup-sweep', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    runFollowupSweepMock.mockResolvedValue(undefined)
    verifyMock.mockResolvedValue(true)
    delete process.env.KANBAN_FOLLOWUP_SWEEP_SECRET
    delete process.env.QSTASH_CURRENT_SIGNING_KEY
    delete process.env.QSTASH_NEXT_SIGNING_KEY
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...saved }
  })

  it('assinatura do QStash válida: roda o sweep', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur'
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next'
    const res = await POST(makeRequest({ 'upstash-signature': 'sig' }))
    expect(res.status).toBe(200)
    expect(runFollowupSweepMock).toHaveBeenCalledOnce()
    expect(receiverCtor).toHaveBeenCalledWith({ currentSigningKey: 'cur', nextSigningKey: 'next' })
    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({ signature: 'sig' }))
  })

  it('assinatura inválida: 401 e não roda', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur'
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next'
    verifyMock.mockResolvedValue(false)
    const res = await POST(makeRequest({ 'upstash-signature': 'ruim' }))
    expect(res.status).toBe(401)
    expect(runFollowupSweepMock).not.toHaveBeenCalled()
  })

  it('verificação lança erro: 401', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur'
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next'
    verifyMock.mockRejectedValue(new Error('jwt'))
    expect((await POST(makeRequest({ 'upstash-signature': 'x' }))).status).toBe(401)
    expect(runFollowupSweepMock).not.toHaveBeenCalled()
  })

  it('sem assinatura e sem segredo: 401 (nunca aberta)', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur'
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next'
    expect((await POST(makeRequest())).status).toBe(401)
    expect(runFollowupSweepMock).not.toHaveBeenCalled()
  })

  it('sem chaves nem segredo configurados: 401', async () => {
    expect((await POST(makeRequest({ 'upstash-signature': 'sig' }))).status).toBe(401)
    expect(runFollowupSweepMock).not.toHaveBeenCalled()
  })

  it('x-workflow-secret correto continua aceito', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 'secret_123'
    const res = await POST(makeRequest({ 'x-workflow-secret': 'secret_123' }))
    expect(res.status).toBe(200)
    expect(runFollowupSweepMock).toHaveBeenCalledOnce()
  })

  it('x-workflow-secret errado: 401', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 'secret_123'
    expect((await POST(makeRequest({ 'x-workflow-secret': 'errado' }))).status).toBe(401)
    expect(runFollowupSweepMock).not.toHaveBeenCalled()
  })

  it('autorizada, mas o sweep falha: 500', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 'secret_123'
    runFollowupSweepMock.mockRejectedValueOnce(new Error('boom'))
    expect((await POST(makeRequest({ 'x-workflow-secret': 'secret_123' }))).status).toBe(500)
  })
})
