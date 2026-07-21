import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const runFollowupSweepMock = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  runFollowupSweep: (...a: unknown[]) => runFollowupSweepMock(...a),
}))

import { POST } from './route'

function makeRequest(secretHeader?: string) {
  return new NextRequest('http://localhost/api/kanban/followup-sweep', {
    method: 'POST',
    headers: secretHeader ? { 'x-workflow-secret': secretHeader } : undefined,
  })
}

describe('POST /api/kanban/followup-sweep', () => {
  const originalSecret = process.env.KANBAN_FOLLOWUP_SWEEP_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    runFollowupSweepMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.KANBAN_FOLLOWUP_SWEEP_SECRET
    else process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = originalSecret
  })

  it('sem KANBAN_FOLLOWUP_SWEEP_SECRET configurado: roda o sweep sem exigir header (dev)', async () => {
    delete process.env.KANBAN_FOLLOWUP_SWEEP_SECRET

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(runFollowupSweepMock).toHaveBeenCalledOnce()
  })

  it('com secret configurado e header correto: roda o sweep', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 'secret_123'

    const res = await POST(makeRequest('secret_123'))

    expect(res.status).toBe(200)
    expect(runFollowupSweepMock).toHaveBeenCalledOnce()
  })

  it('com secret configurado e header ausente/errado: 401, não roda o sweep', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 'secret_123'

    const res = await POST(makeRequest('errado'))

    expect(res.status).toBe(401)
    expect(runFollowupSweepMock).not.toHaveBeenCalled()
  })

  it('runFollowupSweep lançando erro: responde 500', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 'secret_123'
    runFollowupSweepMock.mockRejectedValueOnce(new Error('boom'))

    const res = await POST(makeRequest('secret_123'))

    expect(res.status).toBe(500)
  })
})
