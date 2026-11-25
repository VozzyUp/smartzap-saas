import { describe, it, expect, vi } from 'vitest'

const eqCalls: Array<[string, unknown]> = []
const rowsByTenant: Record<string, any[]> = {
  'tenant-a': [{ phone: '+5511999990001', is_active: true, reason: 'Não tenho interesse', source: 'ai_detected', expires_at: null, created_at: '2026-01-01' }],
  'tenant-b': [{ phone: '+5511999990002', is_active: true, reason: null, source: 'inbound_keyword', expires_at: null, created_at: '2026-01-01' }],
}

vi.mock('@/lib/supabase', () => {
  const builder = (tenant: { id?: string }) => {
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val])
        if (col === 'tenant_id') tenant.id = String(val)
        return b
      },
      in: (_col: string, phones: string[]) =>
        Promise.resolve({
          data: (rowsByTenant[tenant.id || ''] || []).filter((r) => phones.includes(r.phone)),
          error: null,
        }),
    }
    return b
  }
  return { supabase: { from: () => builder({}) } }
})

import { suppressionBadgeLabel, suppressionInboxNotice, attachSuppressions } from './suppression-badge'
import { getActiveSuppressionsByPhone } from './phone-suppressions'

describe('suppressionBadgeLabel', () => {
  it.each(['inbound_keyword', 'ai_detected', 'meta_opt_out_error'])('%s -> pediu para parar', (s) => {
    expect(suppressionBadgeLabel(s)).toBe('Bloqueado · pediu para parar')
  })
  it('auto_failure_policy -> falha de entrega', () => {
    expect(suppressionBadgeLabel('auto_failure_policy')).toBe('Bloqueado · falha de entrega')
  })
  it.each([null, undefined, '', 'manual', 'qualquer'])('origem %j -> só Bloqueado', (s) => {
    expect(suppressionBadgeLabel(s as any)).toBe('Bloqueado')
  })
})

describe('suppressionInboxNotice', () => {
  it('mostra a faixa para opt-out e origem vazia', () => {
    expect(suppressionInboxNotice('ai_detected')).toBe('A IA não responde este contato porque ele pediu para parar.')
    expect(suppressionInboxNotice(null)).not.toBeNull()
  })
  it('não mostra para falha de entrega', () => {
    expect(suppressionInboxNotice('auto_failure_policy')).toBeNull()
  })
})

describe('attachSuppressions', () => {
  const map = new Map([['+5511999990001', { source: 'ai_detected', reason: 'Não tenho interesse', expiresAt: null }]])

  it('casa telefones por forma normalizada (formatado ou sem +)', () => {
    const out = attachSuppressions(
      [{ phone: '+55 (11) 99999-0001' }, { phone: '5511999990001' }, { phone: '+5511988887777' }],
      map
    )
    expect(out.map((c) => c.isSuppressed)).toEqual([true, true, false])
    expect(out[0].suppressionSource).toBe('ai_detected')
    expect(out[2].suppressionSource).toBeNull()
  })
})

describe('isolamento por conta', () => {
  it('filtra por tenant_id e não vaza supressão de outra conta', async () => {
    eqCalls.length = 0
    const a = await getActiveSuppressionsByPhone('tenant-a', ['+5511999990001', '+5511999990002'])
    expect(eqCalls).toContainEqual(['tenant_id', 'tenant-a'])
    expect([...a.keys()]).toEqual(['+5511999990001'])

    const b = await getActiveSuppressionsByPhone('tenant-b', ['+5511999990001', '+5511999990002'])
    expect([...b.keys()]).toEqual(['+5511999990002'])
  })
})
