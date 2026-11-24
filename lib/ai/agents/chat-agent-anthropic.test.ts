import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- mocks (processChatAgent usa imports dinâmicos; vi.mock cobre ambos) ----
const generateTextMock = vi.fn()
const createAnthropicMock = vi.fn((_opts: any) => (modelId: string) => ({ __provider: 'anthropic', modelId }))
const createGoogleMock = vi.fn((_opts: any) => (modelId: string) => ({ __provider: 'google', modelId }))
const createOpenAIMock = vi.fn((_opts: any) => (modelId: string) => ({ __provider: 'openai', modelId }))
let directConfig: any

vi.mock('ai', () => ({
  generateText: (...a: any[]) => generateTextMock(...a),
  tool: (t: any) => t,
  stepCountIs: () => () => false,
}))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: (o: any) => createAnthropicMock(o) }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: (o: any) => createGoogleMock(o) }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: (o: any) => createOpenAIMock(o) }))
vi.mock('@/lib/ai/devtools', () => ({ withDevTools: async (m: any) => m }))
const findRelevantContentMock = vi.fn(async (_p: any) => [{ content: 'Horário: 9h às 18h' }])
const hasIndexedContentMock = vi.fn(async (_id: string) => false)
vi.mock('@/lib/ai/rag-store', () => ({
  findRelevantContent: (p: any) => findRelevantContentMock(p),
  hasIndexedContent: (id: string) => hasIndexedContentMock(id),
  // mesma forma do real: embeddings vêm do agente, independentes do provedor do chat
  buildEmbeddingConfigFromAgent: (a: any) => ({ provider: a.embedding_provider || 'google', model: 'gemini-embedding-001', dimensions: 768 }),
  buildRerankConfigFromAgent: async () => null,
}))
vi.mock('@/lib/ai/mem0-client', () => ({
  isMem0EnabledAsync: async () => false,
  fetchRelevantMemories: vi.fn(),
  saveInteractionMemory: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => null, supabase: {} }))
vi.mock('@/lib/ai/ai-center-config', () => ({ getAiDirectConfig: async () => directConfig }))

import { processChatAgent } from './chat-agent'

const agent: any = {
  id: 'ag1', name: 'Agente', system_prompt: 'Você é um atendente.', model: null,
  temperature: 0.3, max_tokens: 1024, handoff_enabled: true,
  booking_tool_enabled: false, allow_reactions: false, allow_quotes: false,
}
const conversation: any = { id: 'c1', phone: '5511999999999' }
const messages: any[] = [{ id: 'm1', direction: 'inbound', content: 'Oi', message_type: 'text' }]
const run = () => processChatAgent({ tenantId: 't1', agent, conversation, messages })

/** generateText que chama a tool respond como o modelo faria. */
function respondViaTool(params: any) {
  generateTextMock.mockImplementation(async (opts: any) => {
    await opts.tools.respond.execute(params)
    return { text: '', steps: [], finishReason: 'tool-calls' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hasIndexedContentMock.mockResolvedValue(false)
  directConfig = { provider: 'anthropic', model: 'claude-opus-5-5', anthropicApiKey: 'sk-ant-test' }
})

describe('processChatAgent — provedor anthropic', () => {
  it('cria o modelo com createAnthropic({ apiKey }) e usa o modelo configurado', async () => {
    respondViaTool({ message: 'Olá!', sentiment: 'neutral', confidence: 0.9, shouldHandoff: false })
    const r = await run()
    expect(r.success).toBe(true)
    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' })
    expect(createGoogleMock).not.toHaveBeenCalled()
    expect(createOpenAIMock).not.toHaveBeenCalled()
    expect(generateTextMock.mock.calls[0][0].model).toEqual({ __provider: 'anthropic', modelId: 'claude-opus-5-5' })
  })

  it('NÃO envia temperature/topP/topK, usa toolChoice auto, piso de tokens e instrução no prompt', async () => {
    respondViaTool({ message: 'Olá!', sentiment: 'neutral', confidence: 0.9, shouldHandoff: false })
    await run()
    const opts = generateTextMock.mock.calls[0][0]
    expect(opts).not.toHaveProperty('temperature')
    expect(opts).not.toHaveProperty('topP')
    expect(opts).not.toHaveProperty('topK')
    expect(opts.toolChoice).toBe('auto')
    expect(opts).not.toHaveProperty('providerOptions') // nada de thinking/budget_tokens
    expect(opts.maxOutputTokens).toBe(2000) // agente tinha 1024 -> piso
    expect(opts.system).toContain('"respond"')
    expect(opts.system.startsWith('Você é um atendente.')).toBe(true)
  })

  it('mantém max_tokens do agente quando já é maior que o piso', async () => {
    respondViaTool({ message: 'x', sentiment: 'neutral', confidence: 1, shouldHandoff: false })
    await processChatAgent({ tenantId: 't1', agent: { ...agent, max_tokens: 4096 }, conversation, messages })
    expect(generateTextMock.mock.calls[0][0].maxOutputTokens).toBe(4096)
  })

  it('modelo do agente de outro provedor (gemini) cai no padrão da Anthropic', async () => {
    respondViaTool({ message: 'x', sentiment: 'neutral', confidence: 1, shouldHandoff: false })
    await processChatAgent({ tenantId: 't1', agent: { ...agent, model: 'gemini-2.5-flash' }, conversation, messages })
    expect(generateTextMock.mock.calls[0][0].model.modelId).toBe('claude-opus-5-5')
  })

  it('respeita modelo claude escolhido no agente', async () => {
    respondViaTool({ message: 'x', sentiment: 'neutral', confidence: 1, shouldHandoff: false })
    await processChatAgent({ tenantId: 't1', agent: { ...agent, model: 'claude-haiku-5-5' }, conversation, messages })
    expect(generateTextMock.mock.calls[0][0].model.modelId).toBe('claude-haiku-5-5')
  })

  it('resposta em texto sem chamar a tool vira a mensagem (sem erro, sem handoff, sem optOut/funil), sem retries', async () => {
    generateTextMock.mockResolvedValue({ text: 'Claro, posso ajudar com **isso**.', steps: [], finishReason: 'stop' })
    const r = await run()
    expect(r.success).toBe(true)
    expect(r.response?.message).toBe('Claro, posso ajudar com *isso*.')
    expect(r.response?.shouldHandoff).toBe(false)
    expect(r.response).not.toHaveProperty('optOut')
    expect(r.response).not.toHaveProperty('funnelStage')
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })

  it('sem texto e sem tool: cai no handoff automático existente', async () => {
    generateTextMock.mockResolvedValue({ text: '', steps: [], finishReason: 'stop' })
    const r = await run()
    expect(r.success).toBe(false)
    expect(r.response?.shouldHandoff).toBe(true)
  })

  it('erro 401 da Anthropic => mesmo tratamento: auto-handoff', async () => {
    generateTextMock.mockRejectedValue(Object.assign(new Error('invalid x-api-key'), { statusCode: 401 }))
    const r = await run()
    expect(r.success).toBe(false)
    expect(r.response?.shouldHandoff).toBe(true)
    expect(r.response?.handoffReason).toContain('invalid x-api-key')
  })

  it('erro 429 e 400 => auto-handoff com o erro no motivo', async () => {
    for (const [code, msg] of [[429, 'rate limit'], [400, 'temperature not supported']] as const) {
      generateTextMock.mockRejectedValue(Object.assign(new Error(msg), { statusCode: code }))
      const r = await run()
      expect(r.success).toBe(false)
      expect(r.response?.handoffReason).toContain(msg)
    }
  })

  it('chave Anthropic ausente (provedor anthropic, só tem chave Google) => erro claro, sem chamar IA', async () => {
    directConfig = { provider: 'anthropic', model: 'claude-opus-5-5', googleApiKey: 'g' }
    const r = await run()
    expect(r.success).toBe(false)
    expect(r.error).toContain('Anthropic')
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('nenhuma chave => mensagem genérica existente', async () => {
    directConfig = { provider: 'anthropic', model: 'claude-opus-5-5' }
    const r = await run()
    expect(r.error).toContain('Nenhuma chave')
  })
})

describe('processChatAgent — base de conhecimento (RAG) com Anthropic', () => {
  it('a tool searchKnowledgeBase continua disponível e busca com o embedding do AGENTE (não com a Anthropic)', async () => {
    hasIndexedContentMock.mockResolvedValue(true)
    generateTextMock.mockImplementation(async (opts: any) => {
      expect(Object.keys(opts.tools)).toContain('searchKnowledgeBase')
      const found = await opts.tools.searchKnowledgeBase.execute({ query: 'horário?' })
      expect(found.found).toBe(true)
      await opts.tools.respond.execute({ message: 'Das 9h às 18h', sentiment: 'neutral', confidence: 0.9, shouldHandoff: false })
      return { text: '', steps: [], finishReason: 'tool-calls' }
    })
    const r = await run()
    expect(r.success).toBe(true)
    expect(findRelevantContentMock.mock.calls[0][0].embeddingConfig.provider).toBe('google')
    expect(r.response?.sources?.length).toBe(1)
  })
})

describe('processChatAgent — OpenAI/Gemini inalterados', () => {
  it.each([
    ['google', { googleApiKey: 'g' }],
    ['openai', { openaiApiKey: 'o' }],
  ])('%s: toolChoice required, temperature do agente, tokens do agente, sem instrução extra', async (provider, keys) => {
    directConfig = { provider, model: 'm', ...keys }
    respondViaTool({ message: 'x', sentiment: 'neutral', confidence: 1, shouldHandoff: false })
    await run()
    const opts = generateTextMock.mock.calls[0][0]
    expect(opts.toolChoice).toBe('required')
    expect(opts.temperature).toBe(0.3)
    expect(opts.maxOutputTokens).toBe(1024)
    expect(opts.system).toBe('Você é um atendente.')
    expect(createAnthropicMock).not.toHaveBeenCalled()
  })
})
