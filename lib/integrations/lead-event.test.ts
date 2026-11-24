import { describe, it, expect, vi } from 'vitest'
import {
  leadEventSchema,
  processLeadEvent,
  resolveStageName,
  hashToken,
  buildInboundToken,
  verifyInboundToken,
  checkRateLimit,
  type LeadEventDeps,
} from './lead-event'

const ctx = {
  boardId: 'b1',
  boardName: 'Funil',
  stages: [
    { id: 's1', name: 'Em teste' },
    { id: 's2', name: 'Cliente' },
  ],
  currentStageName: null as string | null,
}

function makeDeps(over: Partial<LeadEventDeps> = {}): LeadEventDeps & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getSetting: vi.fn(async (_t: string, k: string) => store.get(k) ?? null),
    setSetting: vi.fn(async (_t: string, k: string, v: string) => void store.set(k, v)),
    findContact: vi.fn(async () => ({ id: 'c1' })),
    createContact: vi.fn(async () => ({ id: 'c-new' })),
    resolveContext: vi.fn(async () => ctx),
    applyStage: vi.fn(async () => 'created' as const),
    ...over,
  }
}

describe('leadEventSchema', () => {
  it('exige phone e event', () => {
    expect(leadEventSchema.safeParse({ phone: '11999998888', event: 'subscribed' }).success).toBe(true)
    expect(leadEventSchema.safeParse({ event: 'x' }).success).toBe(false)
    expect(leadEventSchema.safeParse({ phone: '11999998888' }).success).toBe(false)
    expect(leadEventSchema.safeParse({ phone: '11999998888', event: 'x', email: 'nao-e-email' }).success).toBe(false)
  })
})

describe('resolveStageName', () => {
  it('stage explícito tem precedência sobre o mapa', () => {
    expect(resolveStageName({ event: 'subscribed', stage: 'Outra' }, { subscribed: 'Cliente' })).toBe('Outra')
  })
  it('usa o mapa evento->fase', () => {
    expect(resolveStageName({ event: 'subscribed' }, { subscribed: 'Cliente' })).toBe('Cliente')
  })
  it('sem mapeamento: null', () => {
    expect(resolveStageName({ event: 'canceled' }, { subscribed: 'Cliente' })).toBeNull()
  })
})

describe('processLeadEvent', () => {
  const input = { phone: '(11) 99999-8888', event: 'trial_started' }

  it('cria/move o cartão na fase mapeada para o contato existente', async () => {
    const deps = makeDeps()
    deps.store.set('integration_event_stage_map', JSON.stringify({ trial_started: 'Em teste' }))
    const r = await processLeadEvent('t1', input, deps)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, action: 'created', stage: 'Em teste', contactId: 'c1' })
    expect(deps.applyStage).toHaveBeenCalledWith('t1', 'c1', ctx, 'Em teste')
    expect(deps.findContact).toHaveBeenCalledWith('t1', '+5511999998888')
  })

  it('contato inexistente sem name: 404', async () => {
    const deps = makeDeps({ findContact: vi.fn(async () => null) })
    deps.store.set('integration_event_stage_map', JSON.stringify({ trial_started: 'Em teste' }))
    const r = await processLeadEvent('t1', input, deps)
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('contact_not_found')
    expect(deps.createContact).not.toHaveBeenCalled()
  })

  it('contato inexistente com name: cria o contato', async () => {
    const deps = makeDeps({ findContact: vi.fn(async () => null) })
    deps.store.set('integration_event_stage_map', JSON.stringify({ trial_started: 'Em teste' }))
    const r = await processLeadEvent('t1', { ...input, name: 'Ana', email: 'a@b.com' }, deps)
    expect(r.status).toBe(200)
    expect(deps.createContact).toHaveBeenCalledWith('t1', { phone: '+5511999998888', name: 'Ana', email: 'a@b.com' })
    expect(r.body.contactId).toBe('c-new')
  })

  it('fase inexistente no quadro: 404 com as fases disponíveis', async () => {
    const deps = makeDeps()
    const r = await processLeadEvent('t1', { ...input, stage: 'Fantasma' }, deps)
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('stage_not_found')
    expect(r.body.availableStages).toEqual(['Em teste', 'Cliente'])
    expect(deps.applyStage).not.toHaveBeenCalled()
  })

  it('tenant sem quadro de funil: 404 board_not_found', async () => {
    const deps = makeDeps({ resolveContext: vi.fn(async () => null) })
    const r = await processLeadEvent('t1', { ...input, stage: 'Em teste' }, deps)
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('board_not_found')
  })

  it('evento sem fase mapeada e sem stage: 200 sem mexer no funil', async () => {
    const deps = makeDeps()
    const r = await processLeadEvent('t1', { phone: '11999998888', event: 'canceled' }, deps)
    expect(r.status).toBe(200)
    expect(r.body.action).toBe('no_stage_mapped')
    expect(deps.applyStage).not.toHaveBeenCalled()
  })

  it('idempotente por externalId+event: segunda chamada não reaplica', async () => {
    const deps = makeDeps()
    const body = { ...input, stage: 'Em teste', externalId: 'ext-1' }
    const a = await processLeadEvent('t1', body, deps)
    const b = await processLeadEvent('t1', body, deps)
    expect(a.body.action).toBe('created')
    expect(b.status).toBe(200)
    expect(b.body).toMatchObject({ action: 'duplicate', duplicate: true })
    expect(deps.applyStage).toHaveBeenCalledTimes(1)
  })

  it('externalId igual com event diferente não é duplicata', async () => {
    const deps = makeDeps()
    await processLeadEvent('t1', { ...input, stage: 'Em teste', externalId: 'ext-1' }, deps)
    await processLeadEvent('t1', { ...input, event: 'subscribed', stage: 'Cliente', externalId: 'ext-1' }, deps)
    expect(deps.applyStage).toHaveBeenCalledTimes(2)
  })

  it('não grava a marca de idempotência quando a operação falha (permite reenviar)', async () => {
    const deps = makeDeps({ applyStage: vi.fn(async () => 'error' as const) })
    const r = await processLeadEvent('t1', { ...input, stage: 'Em teste', externalId: 'x' }, deps)
    expect(r.status).toBe(502)
    expect(deps.setSetting).not.toHaveBeenCalled()
  })

  it('cartão pausado é reportado', async () => {
    const deps = makeDeps({ applyStage: vi.fn(async () => 'paused' as const) })
    const r = await processLeadEvent('t1', { ...input, stage: 'Em teste' }, deps)
    expect(r.status).toBe(200)
    expect(r.body.action).toBe('paused')
  })

  it('telefone inválido: 422', async () => {
    const deps = makeDeps()
    const r = await processLeadEvent('t1', { phone: '12', event: 'x', stage: 'Em teste' }, deps)
    expect(r.status).toBe(422)
  })
})

describe('token por conta', () => {
  it('formato tenant.segredo e verificação por hash', async () => {
    const { token, hash } = buildInboundToken('tenant-1')
    expect(token.startsWith('szlead_tenant-1.')).toBe(true)
    const getSetting = vi.fn(async () => hash)
    expect(await verifyInboundToken(token, getSetting)).toEqual({ ok: true, tenantId: 'tenant-1' })
    expect(getSetting).toHaveBeenCalledWith('tenant-1', 'integration_inbound_token')
  })
  it('rejeita token adulterado, de outra conta, malformado ou sem configuração', async () => {
    const { token, hash } = buildInboundToken('tenant-1')
    const get = async (t: string) => (t === 'tenant-1' ? hash : null)
    expect((await verifyInboundToken(token + 'x', get)).ok).toBe(false)
    expect((await verifyInboundToken(token.replace('tenant-1', 'tenant-2'), get)).ok).toBe(false)
    expect((await verifyInboundToken('lixo', get)).ok).toBe(false)
    expect((await verifyInboundToken(token, async () => null)).ok).toBe(false)
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})

describe('checkRateLimit', () => {
  it('bloqueia depois do limite na janela', () => {
    const now = 1_000_000
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k1', 3, 60_000, now)).toBe(true)
    expect(checkRateLimit('k1', 3, 60_000, now)).toBe(false)
    expect(checkRateLimit('k1', 3, 60_000, now + 61_000)).toBe(true)
  })
})
