import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks nomeados por (tabela x operação), no mesmo espírito de lib/kanban.test.ts ---

const boardAutomationsSelectFn = vi.fn()
const kanbanCardsSelectFn = vi.fn()
const kanbanCardsUpdateFn = vi.fn()
const kanbanStagesSelectFn = vi.fn()
const automationLogInsertFn = vi.fn()
const quoteKeywordsSelectFn = vi.fn()
const followupRulesSelectFn = vi.fn()
const automationSettingsSelectFn = vi.fn()
const contactsSelectFn = vi.fn()

function makeChain(handlers: { select?: any; insert?: any; update?: any }) {
  const eqs: Record<string, any> = {}
  const ins: Record<string, any[]> = {}
  let gte: [string, any] | null = null
  let op: 'select' | 'insert' | 'update' | null = null
  let payload: any
  let limited: number | null = null

  const chain: any = {
    select: () => { if (op === null) op = 'select'; return chain },
    insert: (rows: any) => { op = 'insert'; payload = rows; return chain },
    update: (patch: any) => { op = 'update'; payload = patch; return chain },
    eq: (col: string, val: any) => { eqs[col] = val; return chain },
    in: (col: string, vals: any[]) => { ins[col] = vals; return chain },
    gte: (col: string, val: any) => { gte = [col, val]; return chain },
    order: () => chain,
    limit: (n: number) => { limited = n; return chain },
    maybeSingle: () => resolve(),
    then: (resolveFn: any) => resolveFn(resolve()),
  }

  function resolve() {
    if (op === 'select') return handlers.select?.(eqs, ins, gte, limited) ?? { data: null, error: null }
    if (op === 'insert') return handlers.insert?.(payload, eqs) ?? { data: null, error: null }
    if (op === 'update') return handlers.update?.(payload, eqs) ?? { data: null, error: null }
    throw new Error(`unmapped op: ${op}`)
  }

  return chain
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'kanban_board_automations') return makeChain({ select: boardAutomationsSelectFn })
      if (table === 'kanban_cards') return makeChain({ select: kanbanCardsSelectFn, update: kanbanCardsUpdateFn })
      if (table === 'kanban_stages') return makeChain({ select: kanbanStagesSelectFn })
      if (table === 'kanban_card_automation_log') return makeChain({ select: automationLogInsertFn, insert: automationLogInsertFn })
      if (table === 'kanban_quote_keywords') return makeChain({ select: quoteKeywordsSelectFn })
      if (table === 'kanban_stage_followup_rules') return makeChain({ select: followupRulesSelectFn })
      if (table === 'kanban_automation_settings') return makeChain({ select: automationSettingsSelectFn })
      if (table === 'contacts') return makeChain({ select: contactsSelectFn })
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const addCardToBoardMock = vi.fn()
const moveCardMock = vi.fn()
vi.mock('@/lib/kanban', () => {
  class FakeKanbanError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  }
  return {
    addCardToBoard: (...a: any[]) => addCardToBoardMock(...a),
    moveCard: (...a: any[]) => moveCardMock(...a),
    KanbanError: FakeKanbanError,
  }
})

const sendWhatsAppMessageMock = vi.fn()
vi.mock('@/lib/whatsapp-send', () => ({
  sendWhatsAppMessage: (...a: any[]) => sendWhatsAppMessageMock(...a),
}))

import {
  triggerAutomationEvent,
  detectQuoteKeyword,
  runFollowupSweep,
  recordInboundActivity,
  isWithinFollowupWindow,
  shouldTriggerFollowup,
  substituteTemplate,
  matchesAnyKeyword,
} from './kanban-automation'

describe('helpers puros', () => {
  it('isWithinFollowupWindow: dentro do horário e dia útil', () => {
    // 2026-07-20 é uma segunda-feira, 10:00
    const now = new Date('2026-07-20T10:00:00')
    expect(isWithinFollowupWindow(now, { window_start: '09:00', window_end: '18:00', weekdays_mask: 62 })).toBe(true)
  })

  it('isWithinFollowupWindow: fora do horário (antes das 9h)', () => {
    const now = new Date('2026-07-20T03:00:00')
    expect(isWithinFollowupWindow(now, { window_start: '09:00', window_end: '18:00', weekdays_mask: 62 })).toBe(false)
  })

  it('isWithinFollowupWindow: fim de semana não passa mesmo dentro do horário', () => {
    // 2026-07-19 é domingo
    const now = new Date('2026-07-19T10:00:00')
    expect(isWithinFollowupWindow(now, { window_start: '09:00', window_end: '18:00', weekdays_mask: 62 })).toBe(false)
  })

  it('shouldTriggerFollowup: true quando já passou o day_offset', () => {
    const now = new Date('2026-07-20T10:00:00')
    const lastActivity = new Date('2026-07-17T10:00:00') // 3 dias atrás
    expect(shouldTriggerFollowup(now, lastActivity, 3)).toBe(true)
  })

  it('shouldTriggerFollowup: false quando ainda não passou', () => {
    const now = new Date('2026-07-20T10:00:00')
    const lastActivity = new Date('2026-07-19T10:00:00') // 1 dia atrás
    expect(shouldTriggerFollowup(now, lastActivity, 3)).toBe(false)
  })

  it('substituteTemplate substitui variáveis conhecidas e preserva desconhecidas', () => {
    expect(substituteTemplate('Oi {{nome}}, tudo bem? {{outro}}', { nome: 'Maria' })).toBe(
      'Oi Maria, tudo bem? {{outro}}'
    )
  })

  it('matchesAnyKeyword ignora case e acento', () => {
    expect(matchesAnyKeyword('Quanto CUSTA o serviço?', ['custa'])).toBe(true)
    expect(matchesAnyKeyword('Qual o preço do orçamento?', ['orcamento'])).toBe(true)
    expect(matchesAnyKeyword('Oi, tudo bem?', ['orcamento', 'preco'])).toBe(false)
  })
})

describe('triggerAutomationEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sem automação configurada pro evento: no-op silencioso', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({ data: [], error: null })

    await triggerAutomationEvent('tenant_1', 'contact_1', 'client_replied', 'system')

    expect(addCardToBoardMock).not.toHaveBeenCalled()
    expect(moveCardMock).not.toHaveBeenCalled()
  })

  it('contato sem card no board: cria o card no estágio configurado e loga', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({
      data: [{ board_id: 'board_1', target_stage_id: 'stage_sent' }],
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: null, error: null }) // sem card existente
    addCardToBoardMock.mockResolvedValueOnce({ id: 'card_1' })

    await triggerAutomationEvent('tenant_1', 'contact_1', 'message_sent', 'ai')

    expect(addCardToBoardMock).toHaveBeenCalledWith('tenant_1', 'board_1', 'contact_1', 'stage_sent')
    expect(automationLogInsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_1', card_id: 'card_1', event_type: 'stage_moved', source: 'ai' }),
      expect.anything()
    )
  })

  it('card existente, estágio alvo mais avançado: move o card', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({
      data: [{ board_id: 'board_1', target_stage_id: 'stage_replied' }],
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({
      data: { id: 'card_1', stage_id: 'stage_sent', automation_paused: false },
      error: null,
    })
    kanbanStagesSelectFn
      .mockReturnValueOnce({ data: { id: 'stage_sent', position: 0 }, error: null })
      .mockReturnValueOnce({ data: { id: 'stage_replied', position: 1 }, error: null })

    await triggerAutomationEvent('tenant_1', 'contact_1', 'client_replied', 'system')

    expect(moveCardMock).toHaveBeenCalledWith('tenant_1', 'card_1', { stageId: 'stage_replied', position: 0 })
  })

  it('regra anti-cabo-de-guerra: NÃO move o card pra um estágio anterior', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({
      data: [{ board_id: 'board_1', target_stage_id: 'stage_sent' }],
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({
      data: { id: 'card_1', stage_id: 'stage_orcamento', automation_paused: false },
      error: null,
    })
    kanbanStagesSelectFn
      .mockReturnValueOnce({ data: { id: 'stage_orcamento', position: 2 }, error: null })
      .mockReturnValueOnce({ data: { id: 'stage_sent', position: 0 }, error: null })

    await triggerAutomationEvent('tenant_1', 'contact_1', 'message_sent', 'ai')

    expect(moveCardMock).not.toHaveBeenCalled()
  })

  it('card com automation_paused=true: no-op', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({
      data: [{ board_id: 'board_1', target_stage_id: 'stage_replied' }],
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({
      data: { id: 'card_1', stage_id: 'stage_sent', automation_paused: true },
      error: null,
    })

    await triggerAutomationEvent('tenant_1', 'contact_1', 'client_replied', 'system')

    expect(moveCardMock).not.toHaveBeenCalled()
  })
})

describe('detectQuoteKeyword', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retorna true quando o texto contém uma keyword configurada', async () => {
    quoteKeywordsSelectFn.mockReturnValueOnce({ data: [{ keyword: 'orçamento' }, { keyword: 'preço' }], error: null })

    expect(await detectQuoteKeyword('tenant_1', 'Qual o valor do orçamento?')).toBe(true)
  })

  it('retorna false sem keywords configuradas', async () => {
    quoteKeywordsSelectFn.mockReturnValueOnce({ data: [], error: null })

    expect(await detectQuoteKeyword('tenant_1', 'Qual o valor do orçamento?')).toBe(false)
  })
})

describe('recordInboundActivity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('atualiza last_inbound_at em todos os cards do contato (todos os boards)', async () => {
    const now = new Date('2026-07-20T10:00:00.000Z')
    kanbanCardsUpdateFn.mockReturnValueOnce({ error: null })

    await recordInboundActivity('tenant_1', 'contact_1', now)

    expect(kanbanCardsUpdateFn).toHaveBeenCalledWith(
      { last_inbound_at: now.toISOString() },
      expect.objectContaining({ tenant_id: 'tenant_1', contact_id: 'contact_1' })
    )
  })
})

describe('runFollowupSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseCard = {
    id: 'card_1',
    tenant_id: 'tenant_1',
    board_id: 'board_1',
    stage_id: 'stage_1',
    contact_id: 'contact_1',
    moved_at: '2026-07-17T10:00:00.000Z',
    last_inbound_at: null,
    next_followup_index: 0,
  }

  it('dispara o follow-up quando dentro da janela e do prazo, e incrementa o índice', async () => {
    const now = new Date('2026-07-20T10:00:00') // segunda, 10h — dentro da janela default

    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null }) // candidates
    followupRulesSelectFn
      .mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi {{nome}}, tudo bem?' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({
      data: { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: null },
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: 'card_1' }], error: null }) // contactCards p/ dedup
    automationLogInsertFn.mockReturnValueOnce({ data: [], error: null }) // recentSent (nenhum)
    kanbanCardsSelectFn.mockReturnValueOnce({ data: { last_inbound_at: null }, error: null }) // revalidação
    contactsSelectFn.mockReturnValueOnce({ data: { id: 'contact_1', name: 'Maria', phone: '+5511999999999' }, error: null })
    sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'wamid.1' })

    await runFollowupSweep(now)

    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith('tenant_1', {
      to: '+5511999999999',
      type: 'text',
      text: 'Oi Maria, tudo bem?',
    })
    expect(kanbanCardsUpdateFn).toHaveBeenCalledWith({ next_followup_index: 1 }, expect.objectContaining({ id: 'card_1' }))
  })

  it('fora da janela de horário: não envia', async () => {
    const now = new Date('2026-07-20T03:00:00') // 3h da manhã

    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({
      data: { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: null },
      error: null,
    })

    await runFollowupSweep(now)

    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('cliente respondeu enquanto processava (race): revalidação aborta o envio', async () => {
    const now = new Date('2026-07-20T10:00:00')

    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({
      data: { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: null },
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: 'card_1' }], error: null })
    automationLogInsertFn.mockReturnValueOnce({ data: [], error: null })
    // Revalidação: last_inbound_at mudou (cliente respondeu nesse meio-tempo)
    kanbanCardsSelectFn.mockReturnValueOnce({ data: { last_inbound_at: '2026-07-20T09:59:00.000Z' }, error: null })

    await runFollowupSweep(now)

    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('já houve follow-up pro mesmo contato em outro board nas últimas 24h: não duplica', async () => {
    const now = new Date('2026-07-20T10:00:00')

    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({
      data: { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: null },
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: 'card_1' }, { id: 'card_2' }], error: null }) // 2 boards
    automationLogInsertFn.mockReturnValueOnce({ data: [{ id: 'log_1' }], error: null }) // já tem envio recente

    await runFollowupSweep(now)

    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('última regra sem resposta + stale_stage_id configurado: move pro estágio frio', async () => {
    const now = new Date('2026-07-20T10:00:00')
    const cardOnLastRule = { ...baseCard, next_followup_index: 0 }

    kanbanCardsSelectFn.mockReturnValueOnce({ data: [cardOnLastRule], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null }) // só 1 regra
    automationSettingsSelectFn.mockReturnValueOnce({
      data: { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: 'stage_frio' },
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: 'card_1' }], error: null })
    automationLogInsertFn.mockReturnValueOnce({ data: [], error: null })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: { last_inbound_at: null }, error: null })
    contactsSelectFn.mockReturnValueOnce({ data: { id: 'contact_1', name: 'Maria', phone: '+5511999999999' }, error: null })
    sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'wamid.1' })

    await runFollowupSweep(now)

    expect(moveCardMock).toHaveBeenCalledWith('tenant_1', 'card_1', { stageId: 'stage_frio', position: 0 })
  })
})
