import { describe, it, expect, vi, beforeEach } from 'vitest'

const vercelGenerate = vi.fn(async (_a: any) => ({ text: 'ok' }))
let directConfig: any
vi.mock('ai', () => ({ generateText: (a: any) => vercelGenerate(a), streamText: vi.fn() }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: (o: any) => (id: string) => ({ p: 'anthropic', id, o }) }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => (id: string) => ({ p: 'google', id }) }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => (id: string) => ({ p: 'openai', id }) }))
vi.mock('./ai-center-config', () => ({ getAiDirectConfig: async () => directConfig }))

import { generateText } from './unified-ai-service'

beforeEach(() => vi.clearAllMocks())

describe('unified-ai-service com Anthropic', () => {
  it('não envia temperature mesmo quando o chamador passa um valor; aplica piso de tokens', async () => {
    directConfig = { provider: 'anthropic', model: 'claude-opus-5-5', anthropicApiKey: 'K' }
    await generateText({ tenantId: 't', prompt: 'oi', temperature: 0.2, maxOutputTokens: 300 } as any)
    const args = vercelGenerate.mock.calls[0][0]
    expect(args).not.toHaveProperty('temperature')
    expect(args.maxOutputTokens).toBe(2000)
    expect(args.model).toMatchObject({ p: 'anthropic', id: 'claude-opus-5-5' })
  })
  it('anthropic sem maxOutputTokens: usa o piso', async () => {
    directConfig = { provider: 'anthropic', model: 'claude-opus-5-5', anthropicApiKey: 'K' }
    await generateText({ tenantId: 't', prompt: 'oi' } as any)
    expect(vercelGenerate.mock.calls[0][0].maxOutputTokens).toBe(2000)
  })
  it('anthropic sem chave: erro claro', async () => {
    directConfig = { provider: 'anthropic', model: 'claude-opus-5-5' }
    await expect(generateText({ tenantId: 't', prompt: 'oi' } as any)).rejects.toThrow(/Anthropic não configurada/)
  })
  it('openai/google: temperature padrão 0.7 preservada e sem maxOutputTokens quando não informado', async () => {
    directConfig = { provider: 'openai', model: 'gpt-4o', openaiApiKey: 'o' }
    await generateText({ tenantId: 't', prompt: 'oi' } as any)
    const args = vercelGenerate.mock.calls[0][0]
    expect(args.temperature).toBe(0.7)
    expect(args).not.toHaveProperty('maxOutputTokens')
  })
})
