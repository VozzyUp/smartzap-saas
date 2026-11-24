import { describe, it, expect, vi, beforeEach } from 'vitest'

const tplRow = vi.hoisted(() => ({ value: null as any }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: tplRow.value, error: null }),
      }
      return chain
    },
  }),
}))

import { decideFollowupSend, isInside24hWindow, prepareFollowupTemplate, firstName } from './kanban-followup-send'

const now = new Date('2026-11-23T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000)
const tpl = { templateName: 'm', language: 'pt_BR' }

describe('janela de 24 h', () => {
  it('dentro: última mensagem recebida há menos de 24 h', () => {
    expect(isInside24hWindow(now, hoursAgo(23))).toBe(true)
  })
  it('fora: 24 h ou mais, ou nunca respondeu', () => {
    expect(isInside24hWindow(now, hoursAgo(24))).toBe(false)
    expect(isInside24hWindow(now, null)).toBe(false)
  })
})

describe('decideFollowupSend', () => {
  it('dentro da janela, sem modelo: texto livre', () => {
    expect(decideFollowupSend({ now, lastInboundAt: hoursAgo(2), template: null })).toEqual({ mode: 'text' })
  })
  it('dentro da janela, com modelo (sem alwaysSend): texto livre', () => {
    expect(decideFollowupSend({ now, lastInboundAt: hoursAgo(2), template: tpl })).toEqual({ mode: 'text' })
  })
  it('fora da janela, com modelo: modelo', () => {
    expect(decideFollowupSend({ now, lastInboundAt: hoursAgo(50), template: tpl })).toEqual({ mode: 'template' })
  })
  it('fora da janela, sem modelo: NÃO envia', () => {
    expect(decideFollowupSend({ now, lastInboundAt: hoursAgo(50), template: null })).toEqual({
      mode: 'skip',
      reason: 'outside_24h_window_no_template',
    })
  })
  it('contato que nunca respondeu, sem modelo: NÃO envia', () => {
    expect(decideFollowupSend({ now, lastInboundAt: null, template: null }).mode).toBe('skip')
  })
  it('alwaysSend: modelo mesmo dentro da janela', () => {
    expect(decideFollowupSend({ now, lastInboundAt: hoursAgo(1), template: { ...tpl, alwaysSend: true } })).toEqual({ mode: 'template' })
  })
})

describe('prepareFollowupTemplate', () => {
  const contact = { name: 'Maria da Silva', phone: '+5511999999999' }
  beforeEach(() => {
    tplRow.value = {
      status: 'APPROVED',
      parameter_format: 'positional',
      components: [{ type: 'BODY', text: 'Oi {{1}}, seu teste: {{2}}' }],
    }
  })

  it('{{nome}} vira o primeiro nome e o valor fixo é mantido', async () => {
    const r = await prepareFollowupTemplate('t1', { ...tpl, bodyParams: ['{{nome}}', 'https://exemplo.test/cadastro'] }, contact)
    expect(r).toMatchObject({ ok: true, bodyParams: ['Maria', 'https://exemplo.test/cadastro'], language: 'pt_BR' })
    expect((r as any).renderedText).toBe('Oi Maria, seu teste: https://exemplo.test/cadastro')
  })
  it('sem nome no contato: texto de reserva "Cliente"', async () => {
    const r = await prepareFollowupTemplate('t1', { ...tpl, bodyParams: ['{{nome}}', 'x'] }, { name: null, phone: '+55' })
    expect((r as any).bodyParams[0]).toBe('Cliente')
  })
  it('modelo com 1 variável e sem bodyParams: usa o primeiro nome', async () => {
    tplRow.value.components = [{ type: 'BODY', text: 'Oi {{1}}!' }]
    const r = await prepareFollowupTemplate('t1', tpl, contact)
    expect((r as any).bodyParams).toEqual(['Maria'])
  })
  it('modelo sem variável: sem parâmetros', async () => {
    tplRow.value.components = [{ type: 'BODY', text: 'Olá!' }]
    expect(await prepareFollowupTemplate('t1', tpl, contact)).toMatchObject({ ok: true, bodyParams: [] })
  })
  it('quantidade de valores diferente das variáveis: recusa', async () => {
    const r = await prepareFollowupTemplate('t1', { ...tpl, bodyParams: ['{{nome}}'] }, contact)
    expect(r).toEqual({ ok: false, reason: 'template_variable_mismatch' })
  })
  it('modelo inexistente ou não aprovado: recusa', async () => {
    tplRow.value = null
    expect(await prepareFollowupTemplate('t1', tpl, contact)).toEqual({ ok: false, reason: 'template_not_found' })
    tplRow.value = { status: 'PENDING', components: [] }
    expect(await prepareFollowupTemplate('t1', tpl, contact)).toEqual({ ok: false, reason: 'template_not_approved' })
  })
  it('firstName', () => {
    expect(firstName('  Ana Paula ')).toBe('Ana')
    expect(firstName(null)).toBeUndefined()
  })
})
