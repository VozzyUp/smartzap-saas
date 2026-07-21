import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))

const getBoardAutomationConfig = vi.fn()
const saveBoardAutomationConfig = vi.fn()
const listFollowupRules = vi.fn()
const saveFollowupRules = vi.fn()
const listQuoteKeywords = vi.fn()
const addQuoteKeyword = vi.fn()
const removeQuoteKeyword = vi.fn()
const listCardAutomationLog = vi.fn()

vi.mock('@/lib/kanban-automation', () => ({
  getBoardAutomationConfig: (...a: unknown[]) => getBoardAutomationConfig(...a),
  saveBoardAutomationConfig: (...a: unknown[]) => saveBoardAutomationConfig(...a),
  listFollowupRules: (...a: unknown[]) => listFollowupRules(...a),
  saveFollowupRules: (...a: unknown[]) => saveFollowupRules(...a),
  listQuoteKeywords: (...a: unknown[]) => listQuoteKeywords(...a),
  addQuoteKeyword: (...a: unknown[]) => addQuoteKeyword(...a),
  removeQuoteKeyword: (...a: unknown[]) => removeQuoteKeyword(...a),
  listCardAutomationLog: (...a: unknown[]) => listCardAutomationLog(...a),
}))

const authedCtx = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false, trialExpired: false, suspended: false }

function jsonRequest(body: unknown, method = 'POST') {
  return new Request('http://localhost/test', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET/PUT /api/kanban/boards/[id]/automation', () => {
  it('GET sem sessão → 401', async () => {
    getTenantContext.mockResolvedValue(null)
    const { GET } = await import('./boards/[id]/automation/route')
    const res = await GET(new Request('http://localhost/test'), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(401)
  })

  it('GET retorna a configuração do board', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const config = { automations: {}, settings: null }
    getBoardAutomationConfig.mockResolvedValue(config)
    const { GET } = await import('./boards/[id]/automation/route')
    const res = await GET(new Request('http://localhost/test'), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(config)
    expect(getBoardAutomationConfig).toHaveBeenCalledWith('t1', 'b1')
  })

  it('PATCH salva a configuração', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    saveBoardAutomationConfig.mockResolvedValue(undefined)
    const body = {
      automations: { message_sent: { targetStageId: 's1', active: true } },
      settings: { windowStart: '09:00', windowEnd: '18:00', weekdaysMask: 62, staleStageId: null },
    }
    const { PATCH } = await import('./boards/[id]/automation/route')
    const res = await PATCH(jsonRequest(body, 'PATCH'), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(200)
    expect(saveBoardAutomationConfig).toHaveBeenCalledWith('t1', 'b1', body)
  })
})

describe('GET/PUT /api/kanban/stages/[id]/followup-rules', () => {
  it('GET retorna as regras do estágio', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const rules = [{ id: 'r1', dayOffset: 1, templateText: 'Oi', position: 0 }]
    listFollowupRules.mockResolvedValue(rules)
    const { GET } = await import('./stages/[id]/followup-rules/route')
    const res = await GET(new Request('http://localhost/test'), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rules })
  })

  it('PATCH substitui as regras do estágio', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    saveFollowupRules.mockResolvedValue(undefined)
    const rules = [{ dayOffset: 1, templateText: 'Oi', position: 0 }]
    const { PATCH } = await import('./stages/[id]/followup-rules/route')
    const res = await PATCH(jsonRequest({ rules }, 'PATCH'), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)
    expect(saveFollowupRules).toHaveBeenCalledWith('t1', 's1', rules)
  })
})

describe('GET/POST /api/kanban/quote-keywords', () => {
  it('GET lista as palavras-chave', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const keywords = [{ id: 'k1', keyword: 'orçamento' }]
    listQuoteKeywords.mockResolvedValue(keywords)
    const { GET } = await import('./quote-keywords/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ keywords })
  })

  it('POST adiciona uma palavra-chave', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    addQuoteKeyword.mockResolvedValue({ id: 'k2', keyword: 'preço' })
    const { POST } = await import('./quote-keywords/route')
    const res = await POST(jsonRequest({ keyword: 'preço' }))
    expect(res.status).toBe(200)
    expect(addQuoteKeyword).toHaveBeenCalledWith('t1', 'preço')
  })

  it('POST sem keyword → 400', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const { POST } = await import('./quote-keywords/route')
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/kanban/quote-keywords/[id]', () => {
  it('remove a palavra-chave', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    removeQuoteKeyword.mockResolvedValue(undefined)
    const { DELETE } = await import('./quote-keywords/[id]/route')
    const res = await DELETE(new Request('http://localhost/test'), { params: Promise.resolve({ id: 'k1' }) })
    expect(res.status).toBe(200)
    expect(removeQuoteKeyword).toHaveBeenCalledWith('t1', 'k1')
  })
})

describe('GET /api/kanban/cards/[id]/automation-log', () => {
  it('retorna a timeline de automação do card', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const log = [{ id: 'l1', eventType: 'stage_moved', source: 'ai', detail: {}, createdAt: '2026-07-20T10:00:00Z' }]
    listCardAutomationLog.mockResolvedValue(log)
    const { GET } = await import('./cards/[id]/automation-log/route')
    const res = await GET(new Request('http://localhost/test'), { params: Promise.resolve({ id: 'card1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ log })
  })
})
