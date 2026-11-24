import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ value: null as string | null, set: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    get: (...a: unknown[]) => store.get(...a),
    set: (...a: unknown[]) => store.set(...a),
  },
}))

import {
  normalizeFollowupTemplate,
  getFollowupTemplate,
  saveStageFollowupTemplates,
} from './kanban-followup-config'

beforeEach(() => {
  vi.clearAllMocks()
  store.get.mockImplementation(async () => store.value)
  store.set.mockImplementation(async (_t: string, _k: string, v: string) => {
    store.value = v
  })
  store.value = null
})

describe('normalizeFollowupTemplate', () => {
  it('aceita valores fixos e {{nome}} em bodyParams e alwaysSend', () => {
    expect(
      normalizeFollowupTemplate({
        templateName: ' marcoo_teste_lembrete ',
        language: 'pt_BR',
        bodyParams: ['{{nome}}', 'https://exemplo.test/cadastro'],
        alwaysSend: true,
      })
    ).toEqual({
      templateName: 'marcoo_teste_lembrete',
      language: 'pt_BR',
      bodyParams: ['{{nome}}', 'https://exemplo.test/cadastro'],
      alwaysSend: true,
    })
  })
  it('idioma padrão pt_BR; sem nome do modelo: null', () => {
    expect(normalizeFollowupTemplate({ templateName: 'x' })).toEqual({ templateName: 'x', language: 'pt_BR' })
    expect(normalizeFollowupTemplate({ templateName: '  ' })).toBeNull()
    expect(normalizeFollowupTemplate(null)).toBeNull()
  })
})

describe('settings kanban_followup_templates', () => {
  it('salva por estágio e lê pelo índice da regra, escopado ao tenant', async () => {
    await saveStageFollowupTemplates('t1', 's1', [null, { templateName: 'm', language: 'pt_BR' }])
    expect(store.set).toHaveBeenCalledWith('t1', 'kanban_followup_templates', expect.any(String))
    expect(await getFollowupTemplate('t1', 's1', 1)).toEqual({ templateName: 'm', language: 'pt_BR' })
    expect(await getFollowupTemplate('t1', 's1', 0)).toBeNull()
    expect(await getFollowupTemplate('t1', 's2', 0)).toBeNull()
    expect(store.get).toHaveBeenCalledWith('t1', 'kanban_followup_templates')
  })
  it('mantém outros estágios e remove o estágio quando não sobra modelo', async () => {
    await saveStageFollowupTemplates('t1', 's1', [{ templateName: 'a', language: 'pt_BR' }])
    await saveStageFollowupTemplates('t1', 's2', [{ templateName: 'b', language: 'pt_BR' }])
    await saveStageFollowupTemplates('t1', 's1', [null])
    expect(await getFollowupTemplate('t1', 's1', 0)).toBeNull()
    expect((await getFollowupTemplate('t1', 's2', 0))?.templateName).toBe('b')
  })
  it('JSON corrompido: tratado como vazio', async () => {
    store.value = '{nao e json'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getFollowupTemplate('t1', 's1', 0)).toBeNull()
  })
})
