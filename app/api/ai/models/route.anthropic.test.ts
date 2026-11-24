import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, string> = {}
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: async () => ({ tenantId: 'tenant_a' }) }))
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { get: async (_t: string, k: string) => store[k] ?? null } }))

import { GET } from './route'

const get = (provider: string) => GET(new Request(`http://x/api/ai/models?provider=${provider}`) as any)

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; vi.stubGlobal('fetch', vi.fn()) })

describe('/api/ai/models?provider=anthropic', () => {
  it('com chave: devolve exatamente os 3 modelos Claude, sem chamar a rede', async () => {
    store['anthropic_api_key'] = 'k'
    const res = await get('anthropic')
    expect(res.status).toBe(200)
    const { models } = await res.json()
    expect(models.map((m: any) => [m.id, m.name, m.provider])).toEqual([
      ['claude-opus-5-5', 'Claude Opus 5.5', 'anthropic'],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'anthropic'],
      ['claude-haiku-5-5', 'Claude Haiku 5.5', 'anthropic'],
    ])
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sem chave: lista vazia (mesmo padrão dos outros provedores)', async () => {
    expect((await (await get('anthropic')).json()).models).toEqual([])
  })
  it('provedor inválido: 400 citando anthropic', async () => {
    const res = await get('foo')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('anthropic')
  })
})
