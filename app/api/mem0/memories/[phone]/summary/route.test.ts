import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: async () => ({ tenantId: 't1' }) }))
vi.mock('@/lib/supabase-db', () => ({ contactDb: { getByPhone: async () => ({ id: 'c1' }) } }))
const getAiDirectConfig = vi.fn()
vi.mock('@/lib/ai/ai-center-config', () => ({ getAiDirectConfig: (...a: unknown[]) => getAiDirectConfig(...a) }))
const createLanguageModel = vi.fn()
vi.mock('@/lib/ai/llm-model', () => ({ createLanguageModel: (...a: unknown[]) => createLanguageModel(...a) }))

import { POST } from './route'

function req() {
  return new Request('http://x', {
    method: 'POST',
    body: JSON.stringify({ profile: null, memories: [{ memory: 'Cliente quer plano pro' }] }),
  }) as never
}
const params = { params: Promise.resolve({ phone: '5511999999999' }) }

describe('POST summary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 em português quando não há provedor configurado', async () => {
    getAiDirectConfig.mockResolvedValue({ provider: 'google', googleApiKey: null, openaiApiKey: null, anthropicApiKey: null })
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Configure um provedor na Central de IA para gerar o resumo')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('usa o modelo da conta (não string do gateway) e limita a saída', async () => {
    const fakeModel = { id: 'm' }
    getAiDirectConfig.mockResolvedValue({ provider: 'google', googleApiKey: 'k', openaiApiKey: null, anthropicApiKey: null })
    createLanguageModel.mockReturnValue({ model: fakeModel, modelId: 'x' })
    generateText.mockResolvedValue({ text: ' resumo ' })
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).summary).toBe('resumo')
    const arg = generateText.mock.calls[0][0]
    expect(arg.model).toBe(fakeModel)
    expect(arg.maxOutputTokens).toBeLessThanOrEqual(500)
  })

  it('500 quando o provedor falha', async () => {
    getAiDirectConfig.mockResolvedValue({ provider: 'google', googleApiKey: 'k' })
    createLanguageModel.mockReturnValue({ model: {}, modelId: 'x' })
    generateText.mockRejectedValue(new Error('quota'))
    const res = await POST(req(), params)
    expect(res.status).toBe(500)
  })
})
