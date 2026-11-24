import { describe, it, expect } from 'vitest'
import {
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  ANTHROPIC_MIN_MAX_OUTPUT_TOKENS,
  ANTHROPIC_RESPOND_TOOL_INSTRUCTION,
  resolveAnthropicModelId,
  buildLlmCallSettings,
  buildToolInstruction,
  validateAnthropicKey,
} from './anthropic-support'
import { AI_PROVIDERS, defaultModelIdForProvider } from './providers'
import { DEFAULT_MODEL_ID } from './model'

describe('catálogo de modelos Anthropic', () => {
  it('oferece exatamente os 3 modelos, sem sufixo de data', () => {
    expect(ANTHROPIC_MODELS.map((m) => [m.id, m.name])).toEqual([
      ['claude-opus-5-5', 'Claude Opus 5.5'],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
      ['claude-haiku-5-5', 'Claude Haiku 5.5'],
    ])
  })

  it('padrão é claude-opus-5-5 e é o primeiro de AI_PROVIDERS.anthropic', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-opus-5-5')
    const p = AI_PROVIDERS.find((x) => x.id === 'anthropic')
    expect(p?.models[0].id).toBe('claude-opus-5-5')
  })
})

describe('defaultModelIdForProvider (tela de configuração)', () => {
  it('anthropic => claude-opus-5-5; google/openai mantêm o padrão global', () => {
    expect(defaultModelIdForProvider('anthropic')).toBe('claude-opus-5-5')
    expect(defaultModelIdForProvider('google')).toBe(DEFAULT_MODEL_ID)
    expect(defaultModelIdForProvider('openai')).toBe(DEFAULT_MODEL_ID)
    expect(DEFAULT_MODEL_ID).toBe('gemini-2.5-flash')
  })
})

describe('resolveAnthropicModelId', () => {
  it('mantém modelo conhecido', () => {
    expect(resolveAnthropicModelId('claude-haiku-5-5')).toBe('claude-haiku-5-5')
  })
  it('modelo de outro provedor (ex.: gemini) cai no padrão', () => {
    expect(resolveAnthropicModelId('gemini-2.5-flash')).toBe('claude-opus-5-5')
    expect(resolveAnthropicModelId('gpt-4o')).toBe('claude-opus-5-5')
  })
  it('vazio/nulo cai no padrão', () => {
    expect(resolveAnthropicModelId('')).toBe('claude-opus-5-5')
    expect(resolveAnthropicModelId(null)).toBe('claude-opus-5-5')
    expect(resolveAnthropicModelId(undefined)).toBe('claude-opus-5-5')
  })
  it('aceita outro id claude-* (modelo futuro) sem reescrever', () => {
    expect(resolveAnthropicModelId('claude-sonnet-6-0')).toBe('claude-sonnet-6-0')
  })
})

describe('buildLlmCallSettings', () => {
  it('anthropic: NÃO envia temperature e usa toolChoice auto', () => {
    const s = buildLlmCallSettings('anthropic', { temperature: 0.2, maxOutputTokens: 4000, forceTool: true })
    expect(s).not.toHaveProperty('temperature')
    expect(s.toolChoice).toBe('auto')
    expect(s.maxOutputTokens).toBe(4000)
  })
  it('anthropic: nunca envia topP/topK', () => {
    const s = buildLlmCallSettings('anthropic', { temperature: 1, maxOutputTokens: 4000, forceTool: true })
    expect(s).not.toHaveProperty('topP')
    expect(s).not.toHaveProperty('topK')
  })
  it('anthropic: max tokens tem piso (raciocínio consome parte do limite)', () => {
    expect(ANTHROPIC_MIN_MAX_OUTPUT_TOKENS).toBe(2000)
    expect(buildLlmCallSettings('anthropic', { maxOutputTokens: 512, forceTool: true }).maxOutputTokens).toBe(2000)
    expect(buildLlmCallSettings('anthropic', { forceTool: true }).maxOutputTokens).toBe(2000)
  })
  it('anthropic: prompt ganha a instrução de usar a tool respond', () => {
    expect(buildLlmCallSettings('anthropic', { forceTool: true }).systemSuffix).toBe(ANTHROPIC_RESPOND_TOOL_INSTRUCTION)
    expect(ANTHROPIC_RESPOND_TOOL_INSTRUCTION).toContain('respond')
  })
  it('anthropic: instrução cita o nome da tool informado (ex.: suggest)', () => {
    const s = buildLlmCallSettings('anthropic', { forceTool: true, toolName: 'suggest' })
    expect(s.systemSuffix).toBe(buildToolInstruction('suggest'))
    expect(s.systemSuffix).toContain('"suggest"')
    expect(s.systemSuffix).not.toContain('"respond"')
  })
  it('anthropic sem forçar tool: toolChoice auto e sem instrução extra', () => {
    const s = buildLlmCallSettings('anthropic', { forceTool: false })
    expect(s.toolChoice).toBe('auto')
    expect(s.systemSuffix).toBe('')
  })
  it('google/openai: comportamento inalterado (required, temperature, tokens do agente)', () => {
    for (const p of ['google', 'openai'] as const) {
      const s = buildLlmCallSettings(p, { temperature: 0.3, maxOutputTokens: 512, forceTool: true })
      expect(s).toEqual({ toolChoice: 'required', temperature: 0.3, maxOutputTokens: 512, systemSuffix: '' })
    }
  })
  it('google/openai sem forceTool: sem toolChoice forçado', () => {
    expect(buildLlmCallSettings('openai', { temperature: 0.7, forceTool: false }).toolChoice).toBeUndefined()
  })
})

describe('validateAnthropicKey', () => {
  const mk = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch
  it('200 => válida; envia x-api-key e anthropic-version', async () => {
    let seen: { url?: string; init?: RequestInit } = {}
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await validateAnthropicKey('sk-ant-x', f)).toEqual({ valid: true })
    expect(seen.url).toContain('https://api.anthropic.com/v1/models')
    const h = seen.init?.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-ant-x')
    expect(h['anthropic-version']).toBeTruthy()
  })
  it('401 => inválida com mensagem', async () => {
    const r = await validateAnthropicKey('x', mk(401))
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/inválida/i)
  })
  it('403 => acesso negado', async () => {
    expect((await validateAnthropicKey('x', mk(403))).error).toMatch(/negado/i)
  })
  it('429 => limite', async () => {
    expect((await validateAnthropicKey('x', mk(429))).error).toMatch(/limite|quota/i)
  })
  it('erro de rede => inválida com mensagem', async () => {
    const f = (async () => { throw new Error('boom') }) as unknown as typeof fetch
    const r = await validateAnthropicKey('x', f)
    expect(r.valid).toBe(false)
    expect(r.error).toContain('boom')
  })
})
