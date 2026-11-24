import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, string> = {}
const setMock = vi.fn(async (_t: string, k: string, v: string) => { store[k] = v })
const deleteCalls: Array<Record<string, string>> = []
const fetchMock = vi.fn()

vi.mock('@/lib/tenant-context', () => ({ getTenantContext: async () => ({ tenantId: 'tenant_a' }) }))
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: { get: async (_t: string, k: string) => store[k] ?? null, set: (...a: any[]) => (setMock as any)(...a) },
}))
vi.mock('@/lib/ai', () => ({ clearSettingsCache: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    admin: {
      from: () => {
        const f: Record<string, string> = {}
        const q: any = { delete: () => q, eq: (c: string, v: string) => { f[c] = v; if (f.key && f.tenant_id) deleteCalls.push({ ...f }); return Object.assign(Promise.resolve({ error: null }), q) } }
        return q
      },
    },
  },
}))
vi.mock('@/lib/ai/ai-center-config', async () => {
  const actual = await vi.importActual<any>('@/lib/ai/ai-center-config')
  return { ...actual, clearAiCenterCache: vi.fn(), getAiDirectConfig: async () => ({ provider: 'google', model: 'gemini-2.5-flash' }), getAiPromptsConfig: async () => ({}), getAiRoutesConfig: async () => ({}) }
})

import { GET, POST, DELETE } from './route'

const post = (body: any) => POST(new Request('http://x/api/settings/ai', { method: 'POST', body: JSON.stringify(body) }) as any)

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  deleteCalls.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
})

describe('/api/settings/ai — Anthropic', () => {
  it('POST valida a chave na Anthropic (sem gerar tokens) e salva anthropic_api_key do tenant', async () => {
    const res = await post({ anthropic_api_key: 'sk-ant-api03-ABCDEFGH' })
    expect(res.status).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.anthropic.com/v1/models')
    expect(setMock).toHaveBeenCalledWith('tenant_a', 'anthropic_api_key', 'sk-ant-api03-ABCDEFGH')
  })

  it('POST com chave inválida (401) => 400 e NÃO salva', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    const res = await post({ anthropic_api_key: 'ruim' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Anthropic inválida/)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('POST com chave limitada (429) => 400 com mensagem e NÃO salva', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))
    const res = await post({ anthropic_api_key: 'k' })
    expect(res.status).toBe(400)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('POST provider=anthropic sem modelo grava ai_direct com claude-opus-5-5', async () => {
    const res = await post({ provider: 'anthropic' })
    expect(res.status).toBe(200)
    expect(JSON.parse(store['ai_direct'])).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
  })

  it('GET devolve a chave Anthropic só mascarada, nunca em claro', async () => {
    store['anthropic_api_key'] = 'sk-ant-api03-SEGREDOCOMPLETO1234'
    const res = await GET()
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('SEGREDOCOMPLETO')
    const body = JSON.parse(text)
    expect(body.keys.anthropic).toEqual({ isConfigured: true, source: 'database', tokenPreview: 'sk-a...1234' })
  })

  it('GET sem chave => isConfigured false', async () => {
    const body = await (await GET()).json()
    expect(body.keys.anthropic.isConfigured).toBe(false)
  })

  it('DELETE ?provider=anthropic remove anthropic_api_key só do tenant atual', async () => {
    const res = await DELETE(new Request('http://x/api/settings/ai?provider=anthropic', { method: 'DELETE' }) as any)
    expect(res.status).toBe(200)
    expect(deleteCalls).toContainEqual({ key: 'anthropic_api_key', tenant_id: 'tenant_a' })
  })

  it('DELETE com provedor inválido continua 400', async () => {
    const res = await DELETE(new Request('http://x/api/settings/ai?provider=foo', { method: 'DELETE' }) as any)
    expect(res.status).toBe(400)
  })

  it('google/openai continuam validando como antes', async () => {
    await post({ openai_api_key: 'sk-x' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.openai.com')
  })
})
