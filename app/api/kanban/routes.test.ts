import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))

const listBoards = vi.fn()
const createBoard = vi.fn()
const addCardToBoard = vi.fn()
const deleteStage = vi.fn()
const moveCard = vi.fn()
const getContactStages = vi.fn()

class KanbanError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.name = 'KanbanError'
    this.code = code
  }
}

vi.mock('@/lib/kanban', () => ({
  listBoards: (...args: unknown[]) => listBoards(...args),
  createBoard: (...args: unknown[]) => createBoard(...args),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
  getBoardData: vi.fn(),
  createStage: vi.fn(),
  reorderStages: vi.fn(),
  updateStage: vi.fn(),
  deleteStage: (...args: unknown[]) => deleteStage(...args),
  addCardToBoard: (...args: unknown[]) => addCardToBoard(...args),
  moveCard: (...args: unknown[]) => moveCard(...args),
  removeCard: vi.fn(),
  getContactStages: (...args: unknown[]) => getContactStages(...args),
  KanbanError,
}))

const setCardAutomationPaused = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  setCardAutomationPaused: (...args: unknown[]) => setCardAutomationPaused(...args),
}))

const authedCtx = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false, trialExpired: false, suspended: false }

function jsonRequest(body: unknown) {
  return new Request('http://localhost/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  getTenantContext.mockReset()
  listBoards.mockReset()
  createBoard.mockReset()
  addCardToBoard.mockReset()
  deleteStage.mockReset()
  moveCard.mockReset()
  getContactStages.mockReset()
})

describe('GET /api/kanban/boards', () => {
  it('sem sessão → 401', async () => {
    getTenantContext.mockResolvedValue(null)
    const { GET } = await import('./boards/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('POST /api/kanban/boards', () => {
  it('cria board', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const board = { id: 'b1', tenant_id: 't1', name: 'Vendas', position: 0 }
    createBoard.mockResolvedValue(board)
    const { POST } = await import('./boards/route')
    const res = await POST(jsonRequest({ name: 'Vendas' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.board).toEqual(board)
    expect(createBoard).toHaveBeenCalledWith('t1', 'Vendas')
  })
})

describe('POST /api/kanban/boards/[id]/cards', () => {
  it('card duplicado → 409 card_exists', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    addCardToBoard.mockRejectedValue(new KanbanError('card_exists'))
    const { POST } = await import('./boards/[id]/cards/route')
    const res = await POST(jsonRequest({ contactId: 'c1' }), { params: Promise.resolve({ id: 'b1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'card_exists' })
  })
})

describe('DELETE /api/kanban/stages/[id]', () => {
  it('stage com cards → 409 stage_has_cards', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    deleteStage.mockRejectedValue(new KanbanError('stage_has_cards'))
    const { DELETE } = await import('./stages/[id]/route')
    const res = await DELETE(new Request('http://localhost/test'), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'stage_has_cards' })
  })
})

describe('PATCH /api/kanban/cards/[id]', () => {
  it('move card com sucesso', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    moveCard.mockResolvedValue(undefined)
    const { PATCH } = await import('./cards/[id]/route')
    const res = await PATCH(jsonRequest({ stageId: 's2', position: 1 }), { params: Promise.resolve({ id: 'card1' }) })
    expect(res.status).toBe(200)
    expect(moveCard).toHaveBeenCalledWith('t1', 'card1', { stageId: 's2', position: 1 })
  })

  it('alterna o kill switch de automação do card (automationPaused, sem stageId)', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    setCardAutomationPaused.mockResolvedValue(undefined)
    const { PATCH } = await import('./cards/[id]/route')
    const res = await PATCH(jsonRequest({ automationPaused: true }), { params: Promise.resolve({ id: 'card1' }) })
    expect(res.status).toBe(200)
    expect(setCardAutomationPaused).toHaveBeenCalledWith('t1', 'card1', true)
    expect(moveCard).not.toHaveBeenCalled()
  })
})

describe('GET /api/kanban/contact/[contactId]/stages', () => {
  it('retorna lista de fases do contato', async () => {
    getTenantContext.mockResolvedValue(authedCtx)
    const stages = [{ boardId: 'b1', boardName: 'Vendas', stageId: 's1', stageName: 'Novo', stageColor: '#3b82f6', cardId: 'card1' }]
    getContactStages.mockResolvedValue(stages)
    const { GET } = await import('./contact/[contactId]/stages/route')
    const res = await GET(new Request('http://localhost/test'), { params: Promise.resolve({ contactId: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stages).toEqual(stages)
  })
})
