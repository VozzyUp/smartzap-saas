import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks nomeados por (tabela x operação lógica) — mesmo espírito do
// harness de lib/whatsapp-phone-numbers.test.ts, generalizado para 4 tabelas
// (kanban_boards/kanban_stages/kanban_cards/contacts). Cada vi.fn() é
// consumido em ordem via mockReturnValueOnce/mockResolvedValueOnce pelos
// testes, então a ordem das chamadas no código de lib/kanban.ts precisa
// bater com a ordem dos mocks configurados em cada teste. ---

const boardsSelectFn = vi.fn()
const boardsInsertFn = vi.fn()
const boardsUpdateFn = vi.fn()
const boardsDeleteFn = vi.fn()

const stagesSelectFn = vi.fn()
const stagesInsertFn = vi.fn()
const stagesUpdateFn = vi.fn()
const stagesDeleteFn = vi.fn()
const stagesCountFn = vi.fn()

const cardsSelectFn = vi.fn()
const cardsInsertFn = vi.fn()
const cardsUpdateFn = vi.fn()
const cardsDeleteFn = vi.fn()
const cardsCountFn = vi.fn()

const contactsSelectFn = vi.fn()
const contactsUpdateFn = vi.fn()

function makeChain(fns: { select?: any; insert?: any; update?: any; delete?: any; count?: any }) {
  const eqs: Record<string, any> = {}
  let op: 'select' | 'insert' | 'update' | 'delete' | null = null
  let payload: any
  let isCount = false

  const chain: any = {
    select: (_cols: string, opts?: any) => {
      if (op === null) op = 'select'
      if (opts?.count) isCount = true
      return chain
    },
    insert: (rows: any) => {
      op = 'insert'
      payload = rows
      return chain
    },
    update: (patch: any) => {
      op = 'update'
      payload = patch
      return chain
    },
    delete: () => {
      op = 'delete'
      return chain
    },
    eq: (col: string, val: any) => {
      eqs[col] = val
      return chain
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => resolve(),
    single: () => resolve(),
    then: (resolveFn: any) => resolveFn(resolve()),
  }

  function resolve() {
    if (op === 'select') {
      if (isCount && fns.count) return fns.count(eqs)
      return fns.select(eqs, payload)
    }
    if (op === 'insert') return fns.insert(payload, eqs)
    if (op === 'update') return fns.update(payload, eqs)
    if (op === 'delete') return fns.delete(eqs)
    throw new Error(`unmapped op for chain: op=${op}`)
  }

  return chain
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'kanban_boards') {
        return makeChain({ select: boardsSelectFn, insert: boardsInsertFn, update: boardsUpdateFn, delete: boardsDeleteFn })
      }
      if (table === 'kanban_stages') {
        return makeChain({
          select: stagesSelectFn,
          insert: stagesInsertFn,
          update: stagesUpdateFn,
          delete: stagesDeleteFn,
          count: stagesCountFn,
        })
      }
      if (table === 'kanban_cards') {
        return makeChain({
          select: cardsSelectFn,
          insert: cardsInsertFn,
          update: cardsUpdateFn,
          delete: cardsDeleteFn,
          count: cardsCountFn,
        })
      }
      if (table === 'contacts') {
        return makeChain({ select: contactsSelectFn, update: contactsUpdateFn })
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { createBoard, addCardToBoard, moveCard, removeCard, deleteStage, getContactStages, syncStageTag, KanbanError } from '@/lib/kanban'

describe('kanban', () => {
  beforeEach(() => {
    boardsSelectFn.mockReset(); boardsInsertFn.mockReset(); boardsUpdateFn.mockReset(); boardsDeleteFn.mockReset()
    stagesSelectFn.mockReset(); stagesInsertFn.mockReset(); stagesUpdateFn.mockReset(); stagesDeleteFn.mockReset(); stagesCountFn.mockReset()
    cardsSelectFn.mockReset(); cardsInsertFn.mockReset(); cardsUpdateFn.mockReset(); cardsDeleteFn.mockReset(); cardsCountFn.mockReset()
    contactsSelectFn.mockReset(); contactsUpdateFn.mockReset()
  })

  it('createBoard cria o board e as 3 fases padrão', async () => {
    boardsInsertFn.mockReturnValueOnce({ data: { id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 }, error: null })
    stagesInsertFn.mockReturnValueOnce({ error: null })

    const board = await createBoard('t1', 'Vendas')

    expect(board).toEqual({ id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 })
    expect(boardsInsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', name: 'Vendas' }),
      expect.anything()
    )
    expect(stagesInsertFn).toHaveBeenCalledWith(
      [
        expect.objectContaining({ tenant_id: 't1', board_id: 'b1', name: 'Novo', color: '#3b82f6', position: 0 }),
        expect.objectContaining({ tenant_id: 't1', board_id: 'b1', name: 'Em andamento', color: '#f59e0b', position: 1 }),
        expect.objectContaining({ tenant_id: 't1', board_id: 'b1', name: 'Concluído', color: '#22c55e', position: 2 }),
      ],
      expect.anything()
    )
  })

  it('addCardToBoard usa a fase de menor position por padrão e sincroniza a tag', async () => {
    boardsSelectFn.mockReturnValueOnce({ data: { id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 }, error: null })
    stagesSelectFn.mockReturnValueOnce({ data: { id: 's1', tenant_id: 't1', board_id: 'b1', name: 'Novo', color: '#3b82f6', position: 0 }, error: null })
    cardsInsertFn.mockReturnValueOnce({ data: { id: 'c1', tenant_id: 't1', board_id: 'b1', stage_id: 's1', contact_id: 'ct1', position: 0 }, error: null })
    contactsSelectFn.mockReturnValueOnce({ data: { tags: [] }, error: null })
    contactsUpdateFn.mockReturnValueOnce({ error: null })

    const card = await addCardToBoard('t1', 'b1', 'ct1')

    expect(card).toEqual(expect.objectContaining({ id: 'c1', stage_id: 's1', contact_id: 'ct1' }))
    expect(cardsInsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', board_id: 'b1', stage_id: 's1', contact_id: 'ct1' }),
      expect.anything()
    )
    expect(contactsUpdateFn).toHaveBeenCalledWith(
      { tags: ['funil/Vendas: Novo'] },
      expect.objectContaining({ tenant_id: 't1', id: 'ct1' })
    )
  })

  it('addCardToBoard lança card_exists quando o contato já está no board (unique violation)', async () => {
    boardsSelectFn.mockReturnValueOnce({ data: { id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 }, error: null })
    stagesSelectFn.mockReturnValueOnce({ data: { id: 's1', tenant_id: 't1', board_id: 'b1', name: 'Novo', color: '#3b82f6', position: 0 }, error: null })
    cardsInsertFn.mockReturnValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } })

    await expect(addCardToBoard('t1', 'b1', 'ct1')).rejects.toMatchObject({ code: 'card_exists' })
    expect(contactsUpdateFn).not.toHaveBeenCalled()
  })

  it('moveCard atualiza o card e troca a tag da fase antiga pela nova', async () => {
    cardsSelectFn.mockReturnValueOnce({
      data: { id: 'c1', tenant_id: 't1', board_id: 'b1', stage_id: 's1', contact_id: 'ct1', position: 0 },
      error: null,
    })
    stagesSelectFn
      .mockReturnValueOnce({ data: { id: 's2', tenant_id: 't1', board_id: 'b1', name: 'Em andamento', color: '#f59e0b', position: 1 }, error: null }) // target stage
      .mockReturnValueOnce({ data: { id: 's1', tenant_id: 't1', board_id: 'b1', name: 'Novo', color: '#3b82f6', position: 0 }, error: null }) // old stage
    boardsSelectFn.mockReturnValueOnce({ data: { id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 }, error: null })
    cardsUpdateFn.mockReturnValueOnce({ error: null })
    contactsSelectFn.mockReturnValueOnce({ data: { tags: ['funil/Vendas: Novo', 'vip'] }, error: null })
    contactsUpdateFn.mockReturnValueOnce({ error: null })

    await moveCard('t1', 'c1', { stageId: 's2', position: 0 })

    expect(cardsUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ stage_id: 's2', position: 0 }),
      expect.objectContaining({ tenant_id: 't1', id: 'c1' })
    )
    expect(contactsUpdateFn).toHaveBeenCalledWith(
      { tags: ['vip', 'funil/Vendas: Em andamento'] },
      expect.objectContaining({ tenant_id: 't1', id: 'ct1' })
    )
  })

  it('moveCard lança invalid_stage quando a fase alvo é de outro board', async () => {
    cardsSelectFn.mockReturnValueOnce({
      data: { id: 'c1', tenant_id: 't1', board_id: 'b1', stage_id: 's1', contact_id: 'ct1', position: 0 },
      error: null,
    })
    stagesSelectFn.mockReturnValueOnce({ data: { id: 's9', tenant_id: 't1', board_id: 'b2', name: 'Outro board', color: '#000', position: 0 }, error: null })

    await expect(moveCard('t1', 'c1', { stageId: 's9', position: 0 })).rejects.toMatchObject({ code: 'invalid_stage' })
    expect(cardsUpdateFn).not.toHaveBeenCalled()
  })

  it('removeCard deleta o card e remove a tag da fase', async () => {
    cardsSelectFn.mockReturnValueOnce({
      data: { id: 'c1', tenant_id: 't1', board_id: 'b1', stage_id: 's1', contact_id: 'ct1', position: 0 },
      error: null,
    })
    cardsDeleteFn.mockReturnValueOnce({ error: null })
    stagesSelectFn.mockReturnValueOnce({ data: { id: 's1', tenant_id: 't1', board_id: 'b1', name: 'Novo', color: '#3b82f6', position: 0 }, error: null })
    boardsSelectFn.mockReturnValueOnce({ data: { id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 }, error: null })
    contactsSelectFn.mockReturnValueOnce({ data: { tags: ['funil/Vendas: Novo', 'vip'] }, error: null })
    contactsUpdateFn.mockReturnValueOnce({ error: null })

    await removeCard('t1', 'c1')

    expect(cardsDeleteFn).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 't1', id: 'c1' }))
    expect(contactsUpdateFn).toHaveBeenCalledWith(
      { tags: ['vip'] },
      expect.objectContaining({ tenant_id: 't1', id: 'ct1' })
    )
  })

  it('deleteStage lança stage_has_cards quando a fase ainda tem cards', async () => {
    cardsCountFn.mockReturnValueOnce({ data: null, count: 2, error: null })

    await expect(deleteStage('t1', 's1')).rejects.toMatchObject({ code: 'stage_has_cards' })
    expect(stagesDeleteFn).not.toHaveBeenCalled()
  })

  it('deleteStage deleta a fase quando não há cards', async () => {
    cardsCountFn.mockReturnValueOnce({ data: null, count: 0, error: null })
    stagesDeleteFn.mockReturnValueOnce({ error: null })

    await deleteStage('t1', 's1')

    expect(stagesDeleteFn).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 't1', id: 's1' }))
  })

  it('getContactStages retorna as fases do contato escopadas por tenant', async () => {
    cardsSelectFn.mockReturnValueOnce({
      data: [
        {
          id: 'c1',
          board_id: 'b1',
          stage_id: 's1',
          board: { id: 'b1', name: 'Vendas' },
          stage: { id: 's1', name: 'Novo', color: '#3b82f6' },
        },
      ],
      error: null,
    })

    const r = await getContactStages('t1', 'ct1')

    expect(cardsSelectFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 't1', contact_id: 'ct1' }),
      undefined
    )
    expect(r).toEqual([
      { boardId: 'b1', boardName: 'Vendas', stageId: 's1', stageName: 'Novo', stageColor: '#3b82f6', cardId: 'c1' },
    ])
  })

  it('syncStageTag é best-effort: não lança quando a leitura do contato falha', async () => {
    contactsSelectFn.mockReturnValueOnce({ data: null, error: new Error('db down') })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(syncStageTag('t1', 'ct1', 'Vendas', 'Novo', 'Em andamento')).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    expect(contactsUpdateFn).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('syncStageTag é best-effort: não lança quando o update falha', async () => {
    contactsSelectFn.mockReturnValueOnce({ data: { tags: [] }, error: null })
    contactsUpdateFn.mockReturnValueOnce({ error: new Error('write failed') })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(syncStageTag('t1', 'ct1', 'Vendas', null, 'Novo')).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
