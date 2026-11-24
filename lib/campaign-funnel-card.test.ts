import { describe, it, expect, vi } from 'vitest'
import { parseFunnelStage, ensureFunnelCardsForSent } from './campaign-funnel-card'

const fs = { boardId: 'b1', stageId: 's1' }

describe('parseFunnelStage', () => {
  it('lê boardId/stageId das variáveis da campanha', () => {
    expect(parseFunnelStage({ header: [], body: [], funnelStage: fs })).toEqual(fs)
  })
  it('ignora ausente, incompleto ou malformado', () => {
    expect(parseFunnelStage(undefined)).toBeNull()
    expect(parseFunnelStage({ funnelStage: { boardId: 'b1' } })).toBeNull()
    expect(parseFunnelStage({ funnelStage: 'x' })).toBeNull()
  })
})

describe('ensureFunnelCardsForSent', () => {
  it('cria o cartão na fase escolhida para cada contato enviado', async () => {
    const addCard = vi.fn(async () => ({}))
    const r = await ensureFunnelCardsForSent('t1', fs, ['c1', 'c2'], { addCard })
    expect(addCard).toHaveBeenCalledWith('t1', 'b1', 'c1', 's1')
    expect(addCard).toHaveBeenCalledWith('t1', 'b1', 'c2', 's1')
    expect(r).toEqual({ created: 2, existing: 0, failed: 0 })
  })

  it('não duplica nem move: cartão já existente (card_exists) é mantido', async () => {
    const addCard = vi.fn(async () => {
      throw Object.assign(new Error('card_exists'), { code: 'card_exists' })
    })
    const r = await ensureFunnelCardsForSent('t1', fs, ['c1'], { addCard })
    expect(r).toEqual({ created: 0, existing: 1, failed: 0 })
  })

  it('reexecução: segunda rodada só encontra cartões existentes', async () => {
    const seen = new Set<string>()
    const addCard = vi.fn(async (_t: string, _b: string, c: string) => {
      if (seen.has(c)) throw Object.assign(new Error('x'), { code: 'card_exists' })
      seen.add(c)
      return {}
    })
    const a = await ensureFunnelCardsForSent('t1', fs, ['c1', 'c2'], { addCard })
    const b = await ensureFunnelCardsForSent('t1', fs, ['c1', 'c2'], { addCard })
    expect(a.created).toBe(2)
    expect(b).toEqual({ created: 0, existing: 2, failed: 0 })
  })

  it('falha em um contato não interrompe os demais nem lança', async () => {
    const addCard = vi.fn(async (_t: string, _b: string, c: string) => {
      if (c === 'c1') throw new Error('boom')
      return {}
    })
    const logger = vi.fn()
    const r = await ensureFunnelCardsForSent('t1', fs, ['c1', 'c2'], { addCard, logger })
    expect(r).toEqual({ created: 1, existing: 0, failed: 1 })
    expect(logger).toHaveBeenCalled()
  })

  it('sem fase configurada ou sem contatos não faz nada', async () => {
    const addCard = vi.fn()
    expect(await ensureFunnelCardsForSent('t1', null, ['c1'], { addCard })).toEqual({ created: 0, existing: 0, failed: 0 })
    expect(await ensureFunnelCardsForSent('t1', fs, [], { addCard })).toEqual({ created: 0, existing: 0, failed: 0 })
    expect(addCard).not.toHaveBeenCalled()
  })

  it('deduplica contatos repetidos', async () => {
    const addCard = vi.fn(async () => ({}))
    await ensureFunnelCardsForSent('t1', fs, ['c1', 'c1', ' '], { addCard })
    expect(addCard).toHaveBeenCalledTimes(1)
  })
})
