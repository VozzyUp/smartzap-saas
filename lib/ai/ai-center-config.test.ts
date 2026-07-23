import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock do Supabase admin: captura os filtros .eq() aplicados e devolve o
// valor conforme (tenant_id, key). Simula duas contas com chaves diferentes.
type Row = { value: string }
const settingsByTenant: Record<string, Record<string, string>> = {}

function makeQuery() {
  const filters: Record<string, string> = {}
  const q: any = {
    select: () => q,
    eq: (col: string, val: string) => {
      filters[col] = val
      return q
    },
    single: async () => {
      const tenantId = filters['tenant_id']
      const key = filters['key']
      // Sem tenant_id no filtro = bug: query não isolada. O teste falha
      // porque o dado por-tenant não é encontrado sem o filtro certo.
      if (!tenantId) return { data: null, error: { message: 'tenant_id não filtrado' } }
      const value = settingsByTenant[tenantId]?.[key]
      if (value == null) return { data: null, error: { code: 'PGRST116' } }
      return { data: { value } as Row, error: null }
    },
  }
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    admin: {
      from: () => makeQuery(),
    },
  },
}))

// Redis desligado (settingsDb não é usado aqui, mas evita side-effects)
vi.mock('@/lib/redis', () => ({ redis: null }))

import { getAiDirectConfig, clearAiCenterCache } from './ai-center-config'

describe('ai-center-config — isolamento por tenant', () => {
  beforeEach(() => {
    for (const k of Object.keys(settingsByTenant)) delete settingsByTenant[k]
    clearAiCenterCache('tenant_a')
    clearAiCenterCache('tenant_b')
  })

  it('getAiDirectConfig(tenantId) lê a chave do PRÓPRIO tenant, não de outro', async () => {
    settingsByTenant['tenant_a'] = { google_api_key: 'KEY_DO_A' }
    settingsByTenant['tenant_b'] = { google_api_key: 'KEY_DO_B' }

    const configA = await getAiDirectConfig('tenant_a')
    const configB = await getAiDirectConfig('tenant_b')

    expect(configA.googleApiKey).toBe('KEY_DO_A')
    expect(configB.googleApiKey).toBe('KEY_DO_B')
  })

  it('tenant sem chave configurada NÃO herda a chave de outro tenant (sem vazamento)', async () => {
    settingsByTenant['tenant_a'] = { google_api_key: 'KEY_DO_A' }
    // tenant_b não tem chave nenhuma

    const configB = await getAiDirectConfig('tenant_b')

    expect(configB.googleApiKey).toBeUndefined()
    expect(configB.openaiApiKey).toBeUndefined()
  })

  it('cache é por-tenant: o valor de um tenant não contamina a leitura de outro', async () => {
    settingsByTenant['tenant_a'] = { google_api_key: 'KEY_DO_A' }
    settingsByTenant['tenant_b'] = { google_api_key: 'KEY_DO_B' }

    // Aquece o cache do A primeiro
    await getAiDirectConfig('tenant_a')
    // B deve ler o seu próprio valor, não o do A cacheado
    const configB = await getAiDirectConfig('tenant_b')

    expect(configB.googleApiKey).toBe('KEY_DO_B')
  })
})
