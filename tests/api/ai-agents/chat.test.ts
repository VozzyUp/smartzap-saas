import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks BEFORE route imports
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/ai/ai-center-config', () => ({
  getAiDirectConfig: vi.fn(),
}))

vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(),
}))

vi.mock('@/lib/ai/rag-store', () => ({
  findRelevantContent: vi.fn(),
  buildEmbeddingConfigFromAgent: vi.fn(),
  buildRerankConfigFromAgent: vi.fn(),
  hasIndexedContent: vi.fn(),
}))

vi.mock('@/lib/ai/devtools', () => ({
  withDevTools: vi.fn((model) => model),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: vi.fn(),
    tool: vi.fn((config) => config),
    stepCountIs: vi.fn((n) => n),
  }
})

import { POST } from '@/app/api/ai-agents/[id]/chat/route'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getAiDirectConfig } from '@/lib/ai/ai-center-config'
import { getTenantContext } from '@/lib/tenant-context'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { hasIndexedContent } from '@/lib/ai/rag-store'
import { generateText } from 'ai'
import { NextRequest } from 'next/server'

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/ai-agents/test-id/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const mockAgent = {
  id: 'agent-1',
  name: 'Test Agent',
  system_prompt: 'Você é um assistente útil.',
  model: 'gemini-flash',
  temperature: 0.7,
  max_tokens: 2048,
  handoff_enabled: false,
  embedding_provider: 'google',
  rag_max_results: 5,
  rag_similarity_threshold: 0.5,
}

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: mockAgent, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({ tenantId: 'tenant-1' } as any)
  vi.mocked(getSupabaseAdmin).mockReturnValue(mockSupabase as any)
  vi.mocked(getAiDirectConfig).mockResolvedValue({
    provider: 'google',
    model: 'gemini-flash',
    googleApiKey: 'test-key',
  })
  const mockModelFn = vi.fn().mockReturnValue({ type: 'mock-model' })
  vi.mocked(createGoogleGenerativeAI).mockReturnValue(mockModelFn as any)
  vi.mocked(hasIndexedContent).mockResolvedValue(false)
})

describe('POST /api/ai-agents/[id]/chat', () => {
  it('deve responder com sucesso quando o LLM chama o tool respond', async () => {
    vi.mocked(generateText).mockResolvedValue({
      staticToolCalls: [
        {
          toolName: 'respond',
          input: {
            message: 'Olá! Como posso ajudar?',
            sentiment: 'positive',
            confidence: 0.9,
          },
        },
      ],
    } as any)

    const req = makeRequest({ message: 'Olá' })
    const ctx = { params: Promise.resolve({ id: 'agent-1' }) }
    const res = await POST(req, ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.message).toBe('Olá! Como posso ajudar?')
    expect(body.sentiment).toBe('positive')
    expect(body.confidence).toBe(0.9)
  })

  it('deve lançar 500 quando staticToolCalls não contém respond', async () => {
    vi.mocked(generateText).mockResolvedValue({
      staticToolCalls: [],
    } as any)

    const req = makeRequest({ message: 'Olá' })
    const ctx = { params: Promise.resolve({ id: 'agent-1' }) }
    const res = await POST(req, ctx)

    expect(res.status).toBe(500)
  })

  it('deve chamar generateText com toolChoice required', async () => {
    vi.mocked(generateText).mockResolvedValue({
      staticToolCalls: [
        {
          toolName: 'respond',
          input: { message: 'OK', sentiment: 'neutral', confidence: 0.8 },
        },
      ],
    } as any)

    const req = makeRequest({ message: 'Teste' })
    const ctx = { params: Promise.resolve({ id: 'agent-1' }) }
    await POST(req, ctx)

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ toolChoice: 'required' })
    )
  })

  it('deve usar stopWhen com pelo menos 5 steps', async () => {
    vi.mocked(generateText).mockResolvedValue({
      staticToolCalls: [
        {
          toolName: 'respond',
          input: { message: 'OK', sentiment: 'neutral', confidence: 0.8 },
        },
      ],
    } as any)

    const req = makeRequest({ message: 'Teste' })
    const ctx = { params: Promise.resolve({ id: 'agent-1' }) }
    await POST(req, ctx)

    const { stepCountIs } = await import('ai')
    expect(stepCountIs).toHaveBeenCalledWith(expect.any(Number))
    const call = vi.mocked(stepCountIs).mock.calls[0][0]
    expect(call).toBeGreaterThanOrEqual(5)
  })

  it('deve retornar 400 quando body não tem message nem messages', async () => {
    const req = makeRequest({ invalid: true })
    const ctx = { params: Promise.resolve({ id: 'agent-1' }) }
    const res = await POST(req, ctx)

    expect(res.status).toBe(400)
  })
})
