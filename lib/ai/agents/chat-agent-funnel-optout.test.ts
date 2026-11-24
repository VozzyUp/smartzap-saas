import { describe, it, expect } from 'vitest'
import { buildResponseSchema } from './chat-agent'

const base = { message: 'oi', sentiment: 'neutral', confidence: 0.9 }

describe('buildResponseSchema — optOut', () => {
  it('aceita optOut=true e é opcional', () => {
    const s = buildResponseSchema(false)
    expect(s.safeParse({ ...base, optOut: true }).success).toBe(true)
    const r = s.safeParse(base)
    expect(r.success).toBe(true)
  })
})

describe('buildResponseSchema — funnelStage', () => {
  it('sem fases: campo funnelStage não é exigido', () => {
    expect(buildResponseSchema(true).safeParse({ ...base, shouldHandoff: false }).success).toBe(true)
  })

  it('com fases: aceita nome válido e null; rejeita fase inventada', () => {
    const s = buildResponseSchema(false, ['Novo', 'Negociação'])
    expect(s.safeParse({ ...base, funnelStage: 'Negociação' }).success).toBe(true)
    expect(s.safeParse({ ...base, funnelStage: null }).success).toBe(true)
    expect(s.safeParse(base).success).toBe(true)
    expect(s.safeParse({ ...base, funnelStage: 'Inventada' }).success).toBe(false)
  })

  it('combina com handoff', () => {
    const s = buildResponseSchema(true, ['A'])
    expect(s.safeParse({ ...base, shouldHandoff: true, funnelStage: 'A' }).success).toBe(true)
  })
})
