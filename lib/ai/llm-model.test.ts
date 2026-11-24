import { describe, it, expect, vi, beforeEach } from 'vitest'

const createAnthropicMock = vi.fn((_o: any) => (id: string) => ({ p: 'anthropic', id }))
const createGoogleMock = vi.fn((_o: any) => (id: string) => ({ p: 'google', id }))
const createOpenAIMock = vi.fn((_o: any) => (id: string) => ({ p: 'openai', id }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: (o: any) => createAnthropicMock(o) }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: (o: any) => createGoogleMock(o) }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: (o: any) => createOpenAIMock(o) }))

import { createLanguageModel } from './llm-model'

beforeEach(() => vi.clearAllMocks())

describe('createLanguageModel', () => {
  it('anthropic: usa createAnthropic com a chave da conta e resolve o modelo', () => {
    const r = createLanguageModel({ provider: 'anthropic', model: 'claude-sonnet-5-5', anthropicApiKey: 'K' })
    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: 'K' })
    expect(r.model).toEqual({ p: 'anthropic', id: 'claude-sonnet-5-5' })
    expect(r.modelId).toBe('claude-sonnet-5-5')
  })
  it('anthropic: modelo do agente de outro provedor => claude-opus-5-5', () => {
    const r = createLanguageModel({ provider: 'anthropic', model: 'claude-haiku-5-5', anthropicApiKey: 'K' }, 'gemini-2.5-flash')
    expect(r.modelId).toBe('claude-opus-5-5')
  })
  it('anthropic sem chave: erro claro', () => {
    expect(() => createLanguageModel({ provider: 'anthropic', model: 'claude-opus-5-5', googleApiKey: 'g' }))
      .toThrow(/Anthropic não configurada/)
  })
  it('google e openai: comportamento original (modelo do override, erro por chave ausente)', () => {
    expect(createLanguageModel({ provider: 'google', model: 'm', googleApiKey: 'g' }, 'x').model).toEqual({ p: 'google', id: 'x' })
    expect(createLanguageModel({ provider: 'openai', model: 'gpt-4o', openaiApiKey: 'o' }).model).toEqual({ p: 'openai', id: 'gpt-4o' })
    expect(() => createLanguageModel({ provider: 'google', model: 'm' })).toThrow(/Chave Google não configurada/)
    expect(() => createLanguageModel({ provider: 'openai', model: 'm' })).toThrow(/Chave OpenAI não configurada/)
    expect(createAnthropicMock).not.toHaveBeenCalled()
  })
})
