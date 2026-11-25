import { describe, it, expect, vi } from 'vitest'

const calls: Array<{ table: string; eqs: Record<string, unknown>; or?: string }> = []
let rows: any[] = []
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const rec: any = { table, eqs: {} }
      calls.push(rec)
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => ((rec.eqs[k] = v), chain),
        or: (c: string) => ((rec.or = c), chain),
        then: (r: any) => r({ data: rows, error: null }),
      }
      return chain
    },
  }),
}))

import { pickConversationIds, resolveConversationIdsForContacts } from './kanban-conversations'

const row = (id: string, o: Partial<any> = {}) => ({
  id, contact_id: null, phone: null, last_message_at: null, ...o,
})

describe('pickConversationIds', () => {
  it('casa por contact_id', () => {
    const m = pickConversationIds([{ id: 'c1', phone: null }], [row('v1', { contact_id: 'c1' })])
    expect(m.get('c1')).toBe('v1')
  })
  it('casa por telefone normalizado quando não há contact_id', () => {
    const m = pickConversationIds(
      [{ id: 'c1', phone: '(21) 99999-9999' }],
      [row('v1', { phone: '+5521999999999' })]
    )
    expect(m.get('c1')).toBe('v1')
  })
  it('contato sem conversa não aparece', () => {
    const m = pickConversationIds([{ id: 'c1', phone: '+5521999999999' }], [row('v1', { phone: '+5511888888888' })])
    expect(m.has('c1')).toBe(false)
  })
  it('com várias conversas pega a mais recente', () => {
    const m = pickConversationIds(
      [{ id: 'c1', phone: null }],
      [
        row('velha', { contact_id: 'c1', last_message_at: '2026-01-01T00:00:00Z' }),
        row('nova', { contact_id: 'c1', last_message_at: '2026-06-01T00:00:00Z' }),
        row('sem-data', { contact_id: 'c1' }),
      ]
    )
    expect(m.get('c1')).toBe('nova')
  })
  it('contact_id tem prioridade sobre telefone', () => {
    const m = pickConversationIds(
      [{ id: 'c1', phone: '+5521999999999' }],
      [
        row('por-fone', { phone: '+5521999999999', last_message_at: '2026-09-01T00:00:00Z' }),
        row('por-id', { contact_id: 'c1', last_message_at: '2026-01-01T00:00:00Z' }),
      ]
    )
    expect(m.get('c1')).toBe('por-id')
  })
})

describe('resolveConversationIdsForContacts', () => {
  it('filtra pela conta e faz uma única consulta para todos os cartões', async () => {
    calls.length = 0
    rows = [row('v1', { contact_id: 'c1' }), row('v2', { phone: '+5521999999999' })]
    const m = await resolveConversationIdsForContacts('tenant-A', [
      { id: 'c1', phone: null },
      { id: 'c2', phone: '21999999999' },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('inbox_conversations')
    expect(calls[0].eqs.tenant_id).toBe('tenant-A')
    expect(calls[0].or).toContain('contact_id.in.(c1,c2)')
    expect(m.get('c1')).toBe('v1')
    expect(m.get('c2')).toBe('v2')
  })
  it('sem contatos não consulta o banco', async () => {
    calls.length = 0
    expect((await resolveConversationIdsForContacts('t', [])).size).toBe(0)
    expect(calls).toHaveLength(0)
  })
})
