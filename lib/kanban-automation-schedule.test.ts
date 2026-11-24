import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const createMock = vi.fn()
vi.mock('@upstash/qstash', () => ({
  Client: class {
    schedules = { create: (...a: unknown[]) => createMock(...a) }
  },
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.example.com' }))

import {
  registerFollowupSweepSchedule,
  ensureFollowupSweepSchedule,
  __resetFollowupScheduleMemo,
  FOLLOWUP_SWEEP_SCHEDULE_ID,
} from './kanban-automation-schedule'

beforeEach(() => {
  vi.clearAllMocks()
  __resetFollowupScheduleMemo()
  process.env.QSTASH_TOKEN = 'tok'
  delete process.env.KANBAN_FOLLOWUP_SWEEP_SECRET
  createMock.mockResolvedValue({ scheduleId: FOLLOWUP_SWEEP_SCHEDULE_ID })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('registerFollowupSweepSchedule', () => {
  it('cria o cron horário com scheduleId fixo (idempotente) apontando para a rota do sweep', async () => {
    const id = await registerFollowupSweepSchedule()
    expect(id).toBe(FOLLOWUP_SWEEP_SCHEDULE_ID)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'https://app.example.com/api/kanban/followup-sweep',
        cron: '0 * * * *',
        scheduleId: FOLLOWUP_SWEEP_SCHEDULE_ID,
      })
    )
  })
  it('inclui x-workflow-secret quando configurado', async () => {
    process.env.KANBAN_FOLLOWUP_SWEEP_SECRET = 's'
    await registerFollowupSweepSchedule()
    expect(createMock.mock.calls[0][0].headers).toEqual({ 'x-workflow-secret': 's' })
  })
  it('sem QSTASH_TOKEN: lança', async () => {
    delete process.env.QSTASH_TOKEN
    await expect(registerFollowupSweepSchedule()).rejects.toThrow()
  })
})

describe('ensureFollowupSweepSchedule', () => {
  it('registra uma vez por processo (memo) e nunca lança', async () => {
    expect(await ensureFollowupSweepSchedule()).toBe(true)
    expect(await ensureFollowupSweepSchedule()).toBe(true)
    expect(createMock).toHaveBeenCalledTimes(1)
  })
  it('falha da API: devolve false sem lançar e tenta de novo depois', async () => {
    createMock.mockRejectedValueOnce(new Error('qstash'))
    expect(await ensureFollowupSweepSchedule()).toBe(false)
    expect(await ensureFollowupSweepSchedule()).toBe(true)
    expect(createMock).toHaveBeenCalledTimes(2)
  })
})
