import { describe, it, expect, vi, beforeEach } from 'vitest'

const listBoardsMock = vi.fn()
const listStagesMock = vi.fn()
const addCardMock = vi.fn()
const moveCardMock = vi.fn()

vi.mock('@/lib/kanban', () => ({
  listBoards: (...a: unknown[]) => listBoardsMock(...a),
  listStages: (...a: unknown[]) => listStagesMock(...a),
  addCardToBoard: (...a: unknown[]) => addCardMock(...a),
  moveCard: (...a: unknown[]) => moveCardMock(...a),
}))

// settings / kanban_cards via supabase admin
const settingsRow = vi.fn()
const cardRow = vi.fn()
const seenEqs: Array<{ table: string; eqs: Record<string, unknown> }> = []

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const eqs: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => {
          eqs[c] = v
          return chain
        },
        maybeSingle: async () => {
          seenEqs.push({ table, eqs: { ...eqs } })
          if (table === 'settings') return settingsRow(eqs)
          if (table === 'kanban_cards') return cardRow(eqs)
          return { data: null, error: null }
        },
      }
      return chain
    },
  }),
}))

import {
  resolveFunnelContext,
  buildFunnelPromptSection,
  applyFunnelClassification,
  type FunnelContext,
} from './funnel-classifier'

const stagesA = [
  { id: 's1', name: 'Novo', position: 0 },
  { id: 's2', name: 'Negociação', position: 1 },
  { id: 's3', name: 'Fechado', position: 2 },
]

beforeEach(() => {
  vi.clearAllMocks()
  seenEqs.length = 0
  settingsRow.mockResolvedValue({ data: null, error: null })
  cardRow.mockResolvedValue({ data: null, error: null })
  listStagesMock.mockResolvedValue(stagesA)
})

describe('resolveFunnelContext', () => {
  it('tenant com exatamente um quadro e sem setting: usa esse quadro', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'Vendas' }])
    const ctx = await resolveFunnelContext('t1', 'c1')
    expect(ctx?.boardId).toBe('b1')
    expect(ctx?.stages.map((s) => s.name)).toEqual(['Novo', 'Negociação', 'Fechado'])
  })

  it('tenant sem quadro: null (comportamento atual preservado)', async () => {
    listBoardsMock.mockResolvedValue([])
    expect(await resolveFunnelContext('t1', 'c1')).toBeNull()
  })

  it('tenant com dois quadros e sem setting: null', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'A' }, { id: 'b2', name: 'B' }])
    expect(await resolveFunnelContext('t1', 'c1')).toBeNull()
  })

  it('setting ai_funnel_board_id escolhe o quadro entre vários, filtrando por tenant_id', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'A' }, { id: 'b2', name: 'B' }])
    settingsRow.mockResolvedValue({ data: { value: 'b2' }, error: null })
    const ctx = await resolveFunnelContext('t1', 'c1')
    expect(ctx?.boardId).toBe('b2')
    const s = seenEqs.find((x) => x.table === 'settings')!
    expect(s.eqs).toEqual({ tenant_id: 't1', key: 'ai_funnel_board_id' })
  })

  it('setting apontando para quadro inexistente: null (não chuta outro)', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'A' }])
    settingsRow.mockResolvedValue({ data: { value: 'zzz' }, error: null })
    expect(await resolveFunnelContext('t1', 'c1')).toBeNull()
  })

  it('quadro sem fases: null', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'A' }])
    listStagesMock.mockResolvedValue([])
    expect(await resolveFunnelContext('t1', 'c1')).toBeNull()
  })

  it('informa a fase atual do contato quando já tem card', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'A' }])
    cardRow.mockResolvedValue({ data: { id: 'card1', stage_id: 's2', automation_paused: false }, error: null })
    const ctx = await resolveFunnelContext('t1', 'c1')
    expect(ctx?.currentStageName).toBe('Negociação')
    const c = seenEqs.find((x) => x.table === 'kanban_cards')!
    expect(c.eqs).toMatchObject({ tenant_id: 't1', board_id: 'b1', contact_id: 'c1' })
  })

  it('sem contactId: null (contato inexistente)', async () => {
    listBoardsMock.mockResolvedValue([{ id: 'b1', name: 'A' }])
    expect(await resolveFunnelContext('t1', null)).toBeNull()
  })

  it('falha do kanban: null e não lança', async () => {
    listBoardsMock.mockRejectedValue(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await resolveFunnelContext('t1', 'c1')).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('buildFunnelPromptSection', () => {
  it('lista as fases, a fase atual e a instrução de só mudar quando justificar', () => {
    const ctx: FunnelContext = {
      boardId: 'b1',
      boardName: 'Vendas',
      stages: [{ id: 's1', name: 'Novo' }, { id: 's2', name: 'Negociação' }],
      currentStageName: 'Novo',
    }
    const txt = buildFunnelPromptSection(ctx)
    expect(txt).toContain('Novo')
    expect(txt).toContain('Negociação')
    expect(txt).toMatch(/funnelStage/)
    expect(txt).toMatch(/null/)
    expect(txt).toMatch(/Fase atual/)
  })
})

describe('applyFunnelClassification', () => {
  const ctx: FunnelContext = {
    boardId: 'b1',
    boardName: 'Vendas',
    stages: [
      { id: 's1', name: 'Novo' },
      { id: 's2', name: 'Negociação' },
      { id: 's3', name: 'Fechado' },
    ],
    currentStageName: null,
  }

  it('sem card: cria já na fase indicada', async () => {
    cardRow.mockResolvedValue({ data: null, error: null })
    addCardMock.mockResolvedValue({ id: 'card1' })
    const r = await applyFunnelClassification('t1', 'c1', ctx, 'Negociação')
    expect(r).toBe('created')
    expect(addCardMock).toHaveBeenCalledWith('t1', 'b1', 'c1', 's2')
  })

  it('com card em outra fase: move (inclusive para trás)', async () => {
    cardRow.mockResolvedValue({ data: { id: 'card1', stage_id: 's3', automation_paused: false }, error: null })
    const r = await applyFunnelClassification('t1', 'c1', ctx, 'Novo')
    expect(r).toBe('moved')
    expect(moveCardMock).toHaveBeenCalledWith('t1', 'card1', { stageId: 's1', position: 0 })
  })

  it('mesma fase: não faz nada', async () => {
    cardRow.mockResolvedValue({ data: { id: 'card1', stage_id: 's2', automation_paused: false }, error: null })
    expect(await applyFunnelClassification('t1', 'c1', ctx, 'Negociação')).toBe('unchanged')
    expect(moveCardMock).not.toHaveBeenCalled()
    expect(addCardMock).not.toHaveBeenCalled()
  })

  it('card com automation_paused: não move', async () => {
    cardRow.mockResolvedValue({ data: { id: 'card1', stage_id: 's1', automation_paused: true }, error: null })
    expect(await applyFunnelClassification('t1', 'c1', ctx, 'Fechado')).toBe('paused')
    expect(moveCardMock).not.toHaveBeenCalled()
  })

  it('fase inexistente devolvida pelo modelo: ignora', async () => {
    expect(await applyFunnelClassification('t1', 'c1', ctx, 'Inventada')).toBe('invalid_stage')
    expect(addCardMock).not.toHaveBeenCalled()
    expect(moveCardMock).not.toHaveBeenCalled()
  })

  it('null/vazio: não muda', async () => {
    expect(await applyFunnelClassification('t1', 'c1', ctx, null)).toBe('unchanged')
    expect(await applyFunnelClassification('t1', 'c1', ctx, '  ')).toBe('unchanged')
  })

  it('casa nome ignorando caixa/acento', async () => {
    cardRow.mockResolvedValue({ data: null, error: null })
    addCardMock.mockResolvedValue({ id: 'card1' })
    expect(await applyFunnelClassification('t1', 'c1', ctx, 'negociacao')).toBe('created')
    expect(addCardMock).toHaveBeenCalledWith('t1', 'b1', 'c1', 's2')
  })

  it('falha do kanban: captura, loga e retorna error sem lançar', async () => {
    cardRow.mockResolvedValue({ data: { id: 'card1', stage_id: 's1', automation_paused: false }, error: null })
    moveCardMock.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await applyFunnelClassification('t1', 'c1', ctx, 'Fechado')).toBe('error')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
