import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/kanban', () => ({ listStages: vi.fn(), moveCard: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => null }))

import { moveCardsToReadStage, handleReadReceiptForFunnel } from '@/lib/kanban-read-stage'

const stages = [
  { id: 's_new', name: 'Novo', position: 0 },
  { id: 's_sent', name: 'Mensagem enviada', position: 1 },
  { id: 's_read', name: 'Mensagem lida', position: 2 },
  { id: 's_reply', name: 'Respondeu', position: 3 },
  { id: 's_stale', name: 'Sem resposta', position: 4 },
]

function makeDeps(cards: any[], boardStages: any[] = stages) {
  return {
    listCards: vi.fn(async (..._a: any[]) => cards),
    listStages: vi.fn(async (..._a: any[]) => boardStages),
    moveCard: vi.fn(async (..._a: any[]) => {}),
  }
}

describe('moveCardsToReadStage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('move de "Mensagem enviada" para "Mensagem lida" preservando o relógio do follow-up', async () => {
    const deps = makeDeps([{ id: 'c1', board_id: 'b1', stage_id: 's_sent' }])
    const r = await moveCardsToReadStage('t1', 'contact1', deps)
    expect(r.moved).toBe(1)
    expect(deps.moveCard).toHaveBeenCalledWith('t1', 'c1', { stageId: 's_read', position: 0, preserveFollowupClock: true })
  })

  it.each(['s_new', 's_reply', 's_stale', 's_read'])('não move a partir de %s', async (stageId) => {
    const deps = makeDeps([{ id: 'c1', board_id: 'b1', stage_id: stageId }])
    const r = await moveCardsToReadStage('t1', 'contact1', deps)
    expect(r.moved).toBe(0)
    expect(deps.moveCard).not.toHaveBeenCalled()
  })

  it('leitura repetida não faz nada na segunda vez (cartão já em "Mensagem lida")', async () => {
    const card = { id: 'c1', board_id: 'b1', stage_id: 's_sent' }
    const deps = makeDeps([card])
    await moveCardsToReadStage('t1', 'contact1', deps)
    card.stage_id = 's_read'
    await moveCardsToReadStage('t1', 'contact1', deps)
    expect(deps.moveCard).toHaveBeenCalledTimes(1)
  })

  it('quadro sem a fase "Mensagem lida": não move e não lança', async () => {
    const deps = makeDeps([{ id: 'c1', board_id: 'b1', stage_id: 's_sent' }], stages.filter((s) => s.id !== 's_read'))
    await expect(moveCardsToReadStage('t1', 'contact1', deps)).resolves.toEqual({ moved: 0 })
    expect(deps.moveCard).not.toHaveBeenCalled()
  })

  it('não move para trás: "Mensagem lida" posicionada antes de "Mensagem enviada"', async () => {
    const odd = [
      { id: 's_read', name: 'Mensagem lida', position: 0 },
      { id: 's_sent', name: 'Mensagem enviada', position: 1 },
    ]
    const deps = makeDeps([{ id: 'c1', board_id: 'b1', stage_id: 's_sent' }], odd)
    expect((await moveCardsToReadStage('t1', 'contact1', deps)).moved).toBe(0)
  })

  it('respeita automation_paused', async () => {
    const deps = makeDeps([{ id: 'c1', board_id: 'b1', stage_id: 's_sent', automation_paused: true }])
    expect((await moveCardsToReadStage('t1', 'contact1', deps)).moved).toBe(0)
  })

  it('filtra por tenant: repassa o tenant às consultas e ao movimento', async () => {
    const deps = makeDeps([{ id: 'c1', board_id: 'b1', stage_id: 's_sent' }])
    await moveCardsToReadStage('tenant_X', 'contact1', deps)
    expect(deps.listCards).toHaveBeenCalledWith('tenant_X', 'contact1')
    expect(deps.listStages).toHaveBeenCalledWith('tenant_X', 'b1')
    expect(deps.moveCard.mock.calls[0][0]).toBe('tenant_X')
  })

  it('erro ao mover não lança (best-effort) e não derruba os demais cartões', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = makeDeps([
      { id: 'c1', board_id: 'b1', stage_id: 's_sent' },
      { id: 'c2', board_id: 'b1', stage_id: 's_sent' },
    ])
    deps.moveCard.mockRejectedValueOnce(new Error('boom'))
    const r = await moveCardsToReadStage('t1', 'contact1', deps)
    expect(r.moved).toBe(1)
  })
})

describe('handleReadReceiptForFunnel', () => {
  it('resolve o contato pela mensagem (no tenant) e move o cartão', async () => {
    const deps = {
      ...makeDeps([{ id: 'c1', board_id: 'b1', stage_id: 's_sent' }]),
      findContactId: vi.fn(async (..._a: any[]) => 'contact1' as string | null),
    }
    await handleReadReceiptForFunnel('t1', 'wamid.1', deps)
    expect(deps.findContactId).toHaveBeenCalledWith('t1', 'wamid.1')
    expect(deps.moveCard).toHaveBeenCalledTimes(1)
  })

  it('mensagem sem contato conhecido: nada acontece', async () => {
    const deps = { ...makeDeps([]), findContactId: vi.fn(async (..._a: any[]) => null as string | null) }
    await handleReadReceiptForFunnel('t1', 'wamid.x', deps)
    expect(deps.listCards).not.toHaveBeenCalled()
  })

  it('falha ao resolver contato não lança', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = {
      ...makeDeps([]),
      findContactId: vi.fn(async (..._a: any[]): Promise<string | null> => { throw new Error('db') }),
    }
    await expect(handleReadReceiptForFunnel('t1', 'wamid.x', deps)).resolves.toBeUndefined()
  })
})
