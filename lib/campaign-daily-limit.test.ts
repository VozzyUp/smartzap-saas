import { describe, it, expect, vi } from 'vitest'
import {
  parseDailyLimit,
  getDayStartUtc,
  getNextRunAt,
  computeDailyBalance,
  planDailySend,
  countSentToday,
  DAILY_LIMIT_SETTING_KEY,
} from './campaign-daily-limit'

describe('parseDailyLimit', () => {
  it('ausente, vazio, zero, negativo ou lixo = 0 (sem limite)', () => {
    expect(parseDailyLimit(null)).toBe(0)
    expect(parseDailyLimit(undefined)).toBe(0)
    expect(parseDailyLimit('')).toBe(0)
    expect(parseDailyLimit('0')).toBe(0)
    expect(parseDailyLimit('-5')).toBe(0)
    expect(parseDailyLimit('abc')).toBe(0)
  })
  it('inteiro positivo, truncando decimais', () => {
    expect(parseDailyLimit('30')).toBe(30)
    expect(parseDailyLimit(' 30 ')).toBe(30)
    expect(parseDailyLimit('12.9')).toBe(12)
    expect(parseDailyLimit(15)).toBe(15)
  })
  it('usa a chave campaign_daily_limit', () => {
    expect(DAILY_LIMIT_SETTING_KEY).toBe('campaign_daily_limit')
  })
})

describe('getDayStartUtc (America/Sao_Paulo, UTC-3)', () => {
  it('meia-noite local do mesmo dia', () => {
    // 10:00 UTC = 07:00 em SP -> dia começou 03:00 UTC
    expect(getDayStartUtc(new Date('2026-11-23T10:00:00Z')).toISOString()).toBe('2026-11-23T03:00:00.000Z')
  })
  it('antes das 03:00 UTC ainda é o dia anterior em SP', () => {
    expect(getDayStartUtc(new Date('2026-11-23T01:00:00Z')).toISOString()).toBe('2026-11-22T03:00:00.000Z')
  })
})

describe('getNextRunAt', () => {
  it('9h de amanhã no fuso da conta', () => {
    expect(getNextRunAt(new Date('2026-11-23T10:00:00Z')).toISOString()).toBe('2026-11-24T12:00:00.000Z')
  })
  it('depois das 21h em SP (já é outro dia em UTC) continua sendo o dia seguinte local', () => {
    // 2026-11-24T01:00Z = 22:00 de 23/11 em SP -> amanhã = 24/11 09:00 SP = 12:00Z
    expect(getNextRunAt(new Date('2026-11-24T01:00:00Z')).toISOString()).toBe('2026-11-24T12:00:00.000Z')
  })
})

describe('computeDailyBalance', () => {
  it('sem limite retorna null', () => {
    expect(computeDailyBalance(0, 100)).toBeNull()
  })
  it('limite menos enviados, nunca negativo', () => {
    expect(computeDailyBalance(30, 10)).toBe(20)
    expect(computeDailyBalance(30, 30)).toBe(0)
    expect(computeDailyBalance(30, 45)).toBe(0)
  })
})

describe('planDailySend', () => {
  const list = ['a', 'b', 'c', 'd', 'e']
  it('sem limite envia todos', () => {
    expect(planDailySend(list, null)).toEqual({ send: list, deferred: 0 })
  })
  it('corta no saldo e adia o resto', () => {
    expect(planDailySend(list, 2)).toEqual({ send: ['a', 'b'], deferred: 3 })
  })
  it('saldo maior que a lista envia tudo', () => {
    expect(planDailySend(list, 10)).toEqual({ send: list, deferred: 0 })
  })
  it('saldo zero adia tudo', () => {
    expect(planDailySend(list, 0)).toEqual({ send: [], deferred: 5 })
  })
})

describe('countSentToday', () => {
  function makeClient(counts: number[]) {
    const calls: any[] = []
    let i = 0
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((...a: any[]) => { calls.push(['eq', ...a]); return builder }),
      gte: vi.fn((...a: any[]) => { calls.push(['gte', ...a]); return builder }),
      in: vi.fn((...a: any[]) => { calls.push(['in', ...a]); return builder }),
      then: (resolve: any) => resolve({ count: counts[i++], error: null }),
    }
    return { client: { from: vi.fn(() => builder) } as any, calls }
  }
  it('soma enviados (sent_at) e em envio (sending_at) do dia, filtrando por tenant', async () => {
    const { client, calls } = makeClient([12, 3])
    const n = await countSentToday(client, 'tenant-1', new Date('2026-11-23T03:00:00Z'))
    expect(n).toBe(15)
    expect(calls).toContainEqual(['eq', 'tenant_id', 'tenant-1'])
    expect(calls).toContainEqual(['gte', 'sent_at', '2026-11-23T03:00:00.000Z'])
    expect(calls).toContainEqual(['gte', 'sending_at', '2026-11-23T03:00:00.000Z'])
  })
  it('erro de consulta propaga (não assume saldo cheio)', async () => {
    const builder: any = { select: () => builder, eq: () => builder, gte: () => builder, in: () => builder, then: (r: any) => r({ count: null, error: new Error('boom') }) }
    await expect(countSentToday({ from: () => builder } as any, 't', new Date())).rejects.toThrow('boom')
  })
})

import { planDailyDispatch } from './campaign-daily-limit'

describe('planDailyDispatch', () => {
  const now = new Date('2026-11-23T10:00:00Z')
  const eligible = ['a', 'b', 'c', 'd']
  it('sem limite configurado: envia tudo, não consulta o banco', async () => {
    const count = vi.fn()
    const r = await planDailyDispatch({ tenantId: 't', eligible, now, getLimit: async () => 0, count })
    expect(r).toMatchObject({ limited: false, send: eligible, deferred: 0, nextRunAt: null })
    expect(count).not.toHaveBeenCalled()
  })
  it('limite 3 com 1 já enviado hoje: envia 2 e adia 2 para amanhã 9h', async () => {
    const r = await planDailyDispatch({ tenantId: 't', eligible, now, getLimit: async () => 3, count: async () => 1 })
    expect(r.limited).toBe(true)
    expect(r.send).toEqual(['a', 'b'])
    expect(r.deferred).toBe(2)
    expect(r.sentToday).toBe(1)
    expect(r.nextRunAt?.toISOString()).toBe('2026-11-24T12:00:00.000Z')
  })
  it('saldo cabe tudo: sem reprogramação', async () => {
    const r = await planDailyDispatch({ tenantId: 't', eligible, now, getLimit: async () => 10, count: async () => 0 })
    expect(r.deferred).toBe(0)
    expect(r.nextRunAt).toBeNull()
  })
  it('limite já esgotado: nada hoje, tudo para amanhã', async () => {
    const r = await planDailyDispatch({ tenantId: 't', eligible, now, getLimit: async () => 5, count: async () => 9 })
    expect(r.send).toEqual([])
    expect(r.deferred).toBe(4)
    expect(r.nextRunAt).not.toBeNull()
  })
  it('lista vazia: nada a reprogramar', async () => {
    const r = await planDailyDispatch({ tenantId: 't', eligible: [], now, getLimit: async () => 5, count: async () => 9 })
    expect(r.deferred).toBe(0)
    expect(r.nextRunAt).toBeNull()
  })
  it('falha ao contar propaga (não envia no escuro)', async () => {
    await expect(
      planDailyDispatch({ tenantId: 't', eligible, now, getLimit: async () => 5, count: async () => { throw new Error('x') } })
    ).rejects.toThrow('x')
  })
})
