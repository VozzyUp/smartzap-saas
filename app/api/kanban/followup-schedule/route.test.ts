import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))
const ensure = vi.fn()
vi.mock('@/lib/kanban-automation-schedule', () => ({ ensureFollowupSweepSchedule: () => ensure() }))

import { POST } from './route'

beforeEach(() => vi.clearAllMocks())

describe('POST /api/kanban/followup-schedule', () => {
  it('401 sem sessão (não registra)', async () => {
    getTenantContext.mockResolvedValue(null)
    expect((await POST()).status).toBe(401)
    expect(ensure).not.toHaveBeenCalled()
  })
  it('logado: registra e responde 200', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1' })
    ensure.mockResolvedValue(true)
    expect((await POST()).status).toBe(200)
  })
  it('falha ao registrar: 502', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1' })
    ensure.mockResolvedValue(false)
    expect((await POST()).status).toBe(502)
  })
})
