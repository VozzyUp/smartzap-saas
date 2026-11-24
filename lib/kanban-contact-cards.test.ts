import { describe, it, expect, vi, beforeEach } from 'vitest'

const ops: Array<{ table: string; op: string; eqs: Record<string, unknown> }> = []
let cardRows: Array<{ id: string; stage_id: string; board_id: string; contact_id: string }> = []
let listError: unknown = null

function makeChain(table: string) {
  const eqs: Record<string, unknown> = {}
  let op = 'select'
  const chain: any = {
    select: () => chain,
    delete: () => {
      op = 'delete'
      return chain
    },
    update: () => {
      op = 'update'
      return chain
    },
    eq: (k: string, v: unknown) => {
      eqs[k] = v
      return chain
    },
    maybeSingle: async () => {
      ops.push({ table, op, eqs: { ...eqs } })
      if (table === 'kanban_cards') return { data: cardRows.find((c) => c.id === eqs.id) ?? null, error: null }
      return { data: { id: 'x', name: 'N' }, error: null }
    },
    single: async () => ({ data: null, error: null }),
    then: (resolve: any) => {
      ops.push({ table, op, eqs: { ...eqs } })
      if (table === 'kanban_cards' && op === 'select') return resolve({ data: listError ? null : cardRows, error: listError })
      return resolve({ data: null, error: null })
    },
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: (t: string) => makeChain(t) }) }))

import { removeCardsForContact } from './kanban'

describe('removeCardsForContact', () => {
  beforeEach(() => {
    ops.length = 0
    listError = null
    cardRows = [
      { id: 'k1', stage_id: 's1', board_id: 'b1', contact_id: 'c1' },
      { id: 'k2', stage_id: 's2', board_id: 'b2', contact_id: 'c1' },
    ]
  })

  it('apaga todos os cartões do contato, sempre filtrando por tenant', async () => {
    const n = await removeCardsForContact('t1', 'c1')
    expect(n).toBe(2)
    const list = ops.find((o) => o.table === 'kanban_cards' && o.op === 'select' && o.eqs.contact_id)!
    expect(list.eqs).toMatchObject({ tenant_id: 't1', contact_id: 'c1' })
    const deletes = ops.filter((o) => o.table === 'kanban_cards' && o.op === 'delete')
    expect(deletes.map((d) => d.eqs.id).sort()).toEqual(['k1', 'k2'])
    for (const d of deletes) expect(d.eqs.tenant_id).toBe('t1')
  })

  it('contato sem cartão: devolve 0 e não apaga nada', async () => {
    cardRows = []
    expect(await removeCardsForContact('t1', 'c1')).toBe(0)
    expect(ops.some((o) => o.op === 'delete')).toBe(false)
  })

  it('erro ao listar os cartões é lançado (quem chama decide logar)', async () => {
    listError = new Error('db')
    await expect(removeCardsForContact('t1', 'c1')).rejects.toThrow('db')
  })
})
