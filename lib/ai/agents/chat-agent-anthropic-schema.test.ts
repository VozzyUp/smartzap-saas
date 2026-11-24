import { describe, it, expect } from 'vitest'
import { asSchema } from 'ai'
import { buildResponseSchema } from './chat-agent'

// JSON Schema que o AI SDK envia à Anthropic como input_schema da tool `respond`.
async function jsonSchemaOf(handoff: boolean, stages?: string[]) {
  return (await asSchema(buildResponseSchema(handoff, stages)).jsonSchema) as any
}

describe('JSON Schema da tool respond (enviado à Anthropic)', () => {
  it('é um objeto com apenas message, sentiment e confidence obrigatórios (+ shouldHandoff com handoff)', async () => {
    const s = await jsonSchemaOf(true, ['Novo', 'Negociação'])
    expect(s.type).toBe('object')
    expect([...s.required].sort()).toEqual(['confidence', 'message', 'sentiment', 'shouldHandoff'])
  })

  it('não contém `default` em lugar nenhum (nem default: null)', async () => {
    for (const stages of [undefined, ['Novo', 'Negociação']]) {
      const text = JSON.stringify(await jsonSchemaOf(true, stages))
      expect(text).not.toMatch(/"default"/)
    }
  })

  it('funnelStage é enum anulável e opcional; optOut é booleano opcional', async () => {
    const s = await jsonSchemaOf(false, ['Novo', 'Negociação'])
    expect(s.required).not.toContain('funnelStage')
    expect(s.required).not.toContain('optOut')
    expect(s.properties.optOut.type).toBe('boolean')
    const fs = JSON.stringify(s.properties.funnelStage)
    expect(fs).toContain('Negociação')
    expect(fs).toMatch(/"null"/) // anulável via anyOf/type [.., "null"], formas aceitas pela Anthropic
  })

  it('só usa construções de JSON Schema aceitas pela Anthropic (sem $ref/$schema ofensivos, sem additionalProperties inválido)', async () => {
    const s = await jsonSchemaOf(true, ['A'])
    const text = JSON.stringify(s)
    expect(text).not.toContain('$ref')
    expect(text).not.toContain('"not"')
    expect(s.additionalProperties === undefined || s.additionalProperties === false).toBe(true)
  })
})
