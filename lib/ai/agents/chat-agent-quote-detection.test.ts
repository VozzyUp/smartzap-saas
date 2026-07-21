import { describe, it, expect } from 'vitest'
import { baseResponseSchemaForTests } from './chat-agent'

describe('baseResponseSchema — detectedQuoteRequest (automação de Kanban)', () => {
  it('aceita detectedQuoteRequest=true na resposta estruturada da IA', () => {
    const result = baseResponseSchemaForTests.safeParse({
      message: 'Claro, vou te passar o orçamento.',
      sentiment: 'neutral',
      confidence: 0.9,
      detectedQuoteRequest: true,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.detectedQuoteRequest).toBe(true)
  })

  it('detectedQuoteRequest é opcional — resposta sem o campo continua válida', () => {
    const result = baseResponseSchemaForTests.safeParse({
      message: 'Oi, tudo bem?',
      sentiment: 'positive',
      confidence: 0.8,
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.detectedQuoteRequest).toBeUndefined()
  })
})
