import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks nomeados por (tabela x operação), no mesmo espírito de lib/kanban.test.ts ---

const boardAutomationsSelectFn = vi.fn()
const boardAutomationsUpsertFn = vi.fn()
const boardAutomationsDeleteFn = vi.fn()
const kanbanCardsSelectFn = vi.fn()
const kanbanCardsUpdateFn = vi.fn()
const kanbanStagesSelectFn = vi.fn()
const automationLogInsertFn = vi.fn()
const quoteKeywordsSelectFn = vi.fn()
const quoteKeywordsInsertFn = vi.fn()
const quoteKeywordsDeleteFn = vi.fn()
const followupRulesSelectFn = vi.fn()
const followupRulesInsertFn = vi.fn()
const followupRulesDeleteFn = vi.fn()
const automationSettingsSelectFn = vi.fn()
const automationSettingsUpsertFn = vi.fn()
const contactsSelectFn = vi.fn()

function makeChain(handlers: { select?: any; insert?: any; update?: any; upsert?: any; delete?: any }) {
  const eqs: Record<string, any> = {}
  const ins: Record<string, any[]> = {}
  let gte: [string, any] | null = null
  let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | null = null
  let payload: any
  let limited: number | null = null

  const chain: any = {
    select: () => { if (op === null) op = 'select'; return chain },
    insert: (rows: any) => { op = 'insert'; payload = rows; return chain },
    update: (patch: any) => { op = 'update'; payload = patch; return chain },
    upsert: (rows: any, opts?: any) => { op = 'upsert'; payload = { rows, opts }; return chain },
    delete: () => { op = 'delete'; return chain },
    eq: (col: string, val: any) => { eqs[col] = val; return chain },
    in: (col: string, vals: any[]) => { ins[col] = vals; return chain },
    gte: (col: string, val: any) => { gte = [col, val]; return chain },
    order: () => chain,
    limit: (n: number) => { limited = n; return chain },
    maybeSingle: () => resolve(),
    single: () => resolve(),
    then: (resolveFn: any) => resolveFn(resolve()),
  }

  function resolve() {
    if (op === 'select') return handlers.select?.(eqs, ins, gte, limited) ?? { data: null, error: null }
    if (op === 'insert') return handlers.insert?.(payload, eqs) ?? { data: null, error: null }
    if (op === 'update') return handlers.update?.(payload, eqs) ?? { data: null, error: null }
    if (op === 'upsert') return handlers.upsert?.(payload, eqs) ?? { data: null, error: null }
    if (op === 'delete') return handlers.delete?.(eqs) ?? { data: null, error: null }
    throw new Error(`unmapped op: ${op}`)
  }

  return chain
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'kanban_board_automations') {
        return makeChain({ select: boardAutomationsSelectFn, upsert: boardAutomationsUpsertFn, delete: boardAutomationsDeleteFn })
      }
      if (table === 'kanban_cards') return makeChain({ select: kanbanCardsSelectFn, update: kanbanCardsUpdateFn })
      if (table === 'kanban_stages') return makeChain({ select: kanbanStagesSelectFn })
      if (table === 'kanban_card_automation_log') return makeChain({ select: automationLogInsertFn, insert: automationLogInsertFn })
      if (table === 'kanban_quote_keywords') {
        return makeChain({ select: quoteKeywordsSelectFn, insert: quoteKeywordsInsertFn, delete: quoteKeywordsDeleteFn })
      }
      if (table === 'kanban_stage_followup_rules') {
        return makeChain({ select: followupRulesSelectFn, insert: followupRulesInsertFn, delete: followupRulesDeleteFn })
      }
      if (table === 'kanban_automation_settings') {
        return makeChain({ select: automationSettingsSelectFn, upsert: automationSettingsUpsertFn })
      }
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

const suppressionsFn = vi.fn()
vi.mock('@/lib/phone-suppressions', () => ({
  getActiveSuppressionsByPhone: (...a: any[]) => suppressionsFn(...a),
}))
const isTenantBlockedFn = vi.fn()
vi.mock('@/lib/trial', () => ({ isTenantBlocked: (...a: any[]) => isTenantBlockedFn(...a) }))
const getOrCreateConversationFn = vi.fn()
const createInboxMessageFn = vi.fn()
vi.mock('@/lib/inbox/inbox-db', () => ({
  inboxDb: {
    getOrCreateConversation: (...a: any[]) => getOrCreateConversationFn(...a),
    createMessage: (...a: any[]) => createInboxMessageFn(...a),
  },
}))
const notifyOpsAlertFn = vi.fn()
vi.mock('@/lib/ops-alert', () => ({ notifyOpsAlert: (...a: any[]) => notifyOpsAlertFn(...a) }))
const templateMapFn = vi.fn()
const saveTemplatesFn = vi.fn()
vi.mock('@/lib/kanban-followup-config', () => ({
  getFollowupTemplateMap: (...a: any[]) => templateMapFn(...a),
  saveStageFollowupTemplates: (...a: any[]) => saveTemplatesFn(...a),
}))
const prepareTemplateFn = vi.fn()
vi.mock('@/lib/kanban-followup-send', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kanban-followup-send')>('@/lib/kanban-followup-send')
  return { ...actual, prepareFollowupTemplate: (...a: any[]) => prepareTemplateFn(...a) }
})
vi.mock('@/lib/redis', () => ({ redis: null }))
beforeEach(() => {
  templateMapFn.mockResolvedValue({})
})

import { __resetFollowupState } from '@/lib/kanban-followup-state'
import {
  triggerAutomationEvent,
  detectQuoteKeyword,
  runFollowupSweep,
  recordInboundActivity,
  isWithinFollowupWindow,
  shouldTriggerFollowup,
  substituteTemplate,
  matchesAnyKeyword,
  getBoardAutomationConfig,
  saveBoardAutomationConfig,
  listFollowupRules,
  saveFollowupRules,
  listQuoteKeywords,
  addQuoteKeyword,
  removeQuoteKeyword,
  setCardAutomationPaused,
  listCardAutomationLog,
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

  it('mensagem recebida: cartão em "Mensagem lida" vai para "Respondeu" (fase entre as duas)', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({
      data: [{ board_id: 'board_1', target_stage_id: 'stage_replied' }],
      error: null,
    })
    kanbanCardsSelectFn.mockReturnValueOnce({
      data: { id: 'card_1', stage_id: 'stage_read', automation_paused: false },
      error: null,
    })
    kanbanStagesSelectFn
      .mockReturnValueOnce({ data: { id: 'stage_read', name: 'Mensagem lida', position: 2 }, error: null })
      .mockReturnValueOnce({ data: { id: 'stage_replied', name: 'Respondeu', position: 3 }, error: null })

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

describe('getBoardAutomationConfig / saveBoardAutomationConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getBoardAutomationConfig monta o mapa evento->estágio e as configurações de janela', async () => {
    boardAutomationsSelectFn.mockReturnValueOnce({
      data: [
        { event_type: 'message_sent', target_stage_id: 'stage_a', active: true },
        { event_type: 'client_replied', target_stage_id: 'stage_b', active: false },
      ],
      error: null,
    })
    automationSettingsSelectFn.mockReturnValueOnce({
      data: { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: 'stage_frio' },
      error: null,
    })

    const config = await getBoardAutomationConfig('tenant_1', 'board_1')

    expect(config.automations.message_sent).toEqual({ targetStageId: 'stage_a', active: true })
    expect(config.automations.client_replied).toEqual({ targetStageId: 'stage_b', active: false })
    expect(config.settings).toEqual({ windowStart: '09:00', windowEnd: '18:00', weekdaysMask: 62, staleStageId: 'stage_frio' })
  })

  it('saveBoardAutomationConfig faz upsert dos eventos configurados e delete dos removidos (null)', async () => {
    boardAutomationsUpsertFn.mockReturnValue({ data: null, error: null })
    boardAutomationsDeleteFn.mockReturnValue({ data: null, error: null })
    automationSettingsUpsertFn.mockReturnValue({ data: null, error: null })

    await saveBoardAutomationConfig('tenant_1', 'board_1', {
      automations: {
        message_sent: { targetStageId: 'stage_a', active: true },
        client_replied: null,
      },
      settings: { windowStart: '08:00', windowEnd: '17:00', weekdaysMask: 62, staleStageId: null },
    })

    expect(boardAutomationsUpsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.objectContaining({ tenant_id: 'tenant_1', board_id: 'board_1', event_type: 'message_sent', target_stage_id: 'stage_a', active: true }),
        opts: expect.objectContaining({ onConflict: 'board_id,event_type' }),
      }),
      {}
    )
    expect(boardAutomationsDeleteFn).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_1', board_id: 'board_1', event_type: 'client_replied' })
    )
    expect(automationSettingsUpsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.objectContaining({ tenant_id: 'tenant_1', board_id: 'board_1', window_start: '08:00', window_end: '17:00' }),
        opts: expect.objectContaining({ onConflict: 'board_id' }),
      }),
      {}
    )
  })
})

describe('listFollowupRules / saveFollowupRules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listFollowupRules retorna as regras ordenadas por position', async () => {
    followupRulesSelectFn.mockReturnValueOnce({
      data: [{ id: 'r1', day_offset: 1, template_text: 'Oi', position: 0 }],
      error: null,
    })

    const rules = await listFollowupRules('tenant_1', 'stage_1')

    expect(rules).toEqual([{ id: 'r1', dayOffset: 1, templateText: 'Oi', position: 0, template: null }])
  })

  it('listFollowupRules devolve o modelo associado (settings) pelo índice da regra', async () => {
    templateMapFn.mockResolvedValueOnce({
      stage_1: [{ templateName: 'marcoo_teste_lembrete', language: 'pt_BR', bodyParams: ['{{nome}}', 'https://x.test'], alwaysSend: true }],
    })
    followupRulesSelectFn.mockReturnValueOnce({
      data: [{ id: 'r1', day_offset: 1, template_text: 'Oi', position: 0 }],
      error: null,
    })
    const rules = await listFollowupRules('tenant_1', 'stage_1')
    expect(rules[0].template).toEqual({
      templateName: 'marcoo_teste_lembrete',
      language: 'pt_BR',
      bodyParams: ['{{nome}}', 'https://x.test'],
      alwaysSend: true,
    })
  })

  it('saveFollowupRules grava as associações de modelo do estágio', async () => {
    followupRulesDeleteFn.mockReturnValueOnce({ data: null, error: null })
    followupRulesInsertFn.mockReturnValueOnce({ data: null, error: null })
    const template = { templateName: 'm', language: 'pt_BR' }
    await saveFollowupRules('tenant_1', 'stage_1', [
      { dayOffset: 3, templateText: 'a', position: 0, template },
      { dayOffset: 5, templateText: 'b', position: 1 },
    ])
    expect(saveTemplatesFn).toHaveBeenCalledWith('tenant_1', 'stage_1', [template, null])
  })

  it('saveFollowupRules apaga as regras antigas e insere a lista nova em ordem', async () => {
    followupRulesDeleteFn.mockReturnValueOnce({ data: null, error: null })
    followupRulesInsertFn.mockReturnValueOnce({ data: null, error: null })

    await saveFollowupRules('tenant_1', 'stage_1', [
      { dayOffset: 1, templateText: 'Dia 1', position: 0 },
      { dayOffset: 3, templateText: 'Dia 3', position: 1 },
    ])

    expect(followupRulesDeleteFn).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant_1', stage_id: 'stage_1' }))
    expect(followupRulesInsertFn).toHaveBeenCalledWith(
      [
        expect.objectContaining({ tenant_id: 'tenant_1', stage_id: 'stage_1', day_offset: 1, template_text: 'Dia 1', position: 0 }),
        expect.objectContaining({ tenant_id: 'tenant_1', stage_id: 'stage_1', day_offset: 3, template_text: 'Dia 3', position: 1 }),
      ],
      {}
    )
  })

  it('saveFollowupRules com lista vazia: só apaga, não insere', async () => {
    followupRulesDeleteFn.mockReturnValueOnce({ data: null, error: null })

    await saveFollowupRules('tenant_1', 'stage_1', [])

    expect(followupRulesInsertFn).not.toHaveBeenCalled()
  })
})

describe('quote keywords CRUD', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listQuoteKeywords retorna as palavras do tenant', async () => {
    quoteKeywordsSelectFn.mockReturnValueOnce({ data: [{ id: 'k1', keyword: 'orçamento' }], error: null })

    expect(await listQuoteKeywords('tenant_1')).toEqual([{ id: 'k1', keyword: 'orçamento' }])
  })

  it('addQuoteKeyword insere e retorna a palavra criada', async () => {
    quoteKeywordsInsertFn.mockReturnValueOnce({ data: { id: 'k2', keyword: 'preço' }, error: null })

    expect(await addQuoteKeyword('tenant_1', 'preço')).toEqual({ id: 'k2', keyword: 'preço' })
  })

  it('removeQuoteKeyword deleta por id escopado ao tenant', async () => {
    quoteKeywordsDeleteFn.mockReturnValueOnce({ data: null, error: null })

    await removeQuoteKeyword('tenant_1', 'k1')

    expect(quoteKeywordsDeleteFn).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant_1', id: 'k1' }))
  })
})

describe('setCardAutomationPaused / listCardAutomationLog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('setCardAutomationPaused atualiza a flag do card', async () => {
    kanbanCardsUpdateFn.mockReturnValueOnce({ data: null, error: null })

    await setCardAutomationPaused('tenant_1', 'card_1', true)

    expect(kanbanCardsUpdateFn).toHaveBeenCalledWith(
      { automation_paused: true },
      expect.objectContaining({ tenant_id: 'tenant_1', id: 'card_1' })
    )
  })

  it('listCardAutomationLog retorna o histórico do card mais recente primeiro', async () => {
    automationLogInsertFn.mockReturnValueOnce({
      data: [{ id: 'log_1', event_type: 'stage_moved', source: 'ai', detail: {}, created_at: '2026-07-20T10:00:00Z' }],
      error: null,
    })

    const log = await listCardAutomationLog('tenant_1', 'card_1')

    expect(log).toEqual([
      { id: 'log_1', eventType: 'stage_moved', source: 'ai', detail: {}, createdAt: '2026-07-20T10:00:00Z' },
    ])
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
    __resetFollowupState()
    suppressionsFn.mockResolvedValue(new Map())
    isTenantBlockedFn.mockResolvedValue(false)
    templateMapFn.mockResolvedValue({})
    getOrCreateConversationFn.mockResolvedValue({ id: 'conv_1' })
    createInboxMessageFn.mockResolvedValue({})
    prepareTemplateFn.mockResolvedValue({
      ok: true,
      templateName: 'marcoo_estetica_segundo_contato',
      language: 'pt_BR',
      bodyParams: ['Maria'],
      renderedText: 'Oi Maria, tudo bem?',
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  const baseCard = {
    id: 'card_1',
    tenant_id: 'tenant_1',
    board_id: 'board_1',
    stage_id: 'stage_1',
    contact_id: 'contact_1',
    moved_at: '2026-07-17T10:00:00.000Z',
    last_inbound_at: null as string | null,
    next_followup_index: 0,
  }
  const withTemplate = (over: Record<string, unknown> = {}) =>
    templateMapFn.mockResolvedValue({
      stage_1: [{ templateName: 'marcoo_estetica_segundo_contato', language: 'pt_BR', alwaysSend: true, ...over }],
    })
  const settingsOk = { window_start: '09:00', window_end: '18:00', weekdays_mask: 62, stale_stage_id: null }
  const now = new Date('2026-07-20T10:00:00') // segunda, 10h — dentro da janela de horário

  /** Enfileira as leituras de uma rodada completa até o envio. */
  function queueRound(card: any = baseCard, rules: any[] = [{ id: 'rule_1', day_offset: 3, template_text: 'Oi {{nome}}' }], settings: any = settingsOk) {
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [card], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: rules, error: null })
    automationSettingsSelectFn.mockReturnValueOnce({ data: settings, error: null })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: card.id }], error: null })
    automationLogInsertFn.mockReturnValueOnce({ data: [], error: null })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: { last_inbound_at: card.last_inbound_at }, error: null })
    contactsSelectFn.mockReturnValueOnce({ data: { id: 'contact_1', name: 'Maria Silva', phone: '+5511999999999' }, error: null })
  }

  it('fora da janela de 24h COM modelo: envia o modelo, avança o índice e grava no inbox', async () => {
    withTemplate()
    queueRound()
    sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'wamid.1' })

    await runFollowupSweep(now)

    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith('tenant_1', {
      to: '+5511999999999',
      type: 'template',
      templateName: 'marcoo_estetica_segundo_contato',
      templateLanguage: 'pt_BR',
      templateParams: { body: ['Maria'] },
    })
    expect(kanbanCardsUpdateFn).toHaveBeenCalledWith({ next_followup_index: 1 }, expect.objectContaining({ id: 'card_1' }))
    expect(getOrCreateConversationFn).toHaveBeenCalledWith('tenant_1', expect.any(String), 'contact_1')
    expect(createInboxMessageFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant_1',
        conversation_id: 'conv_1',
        direction: 'outbound',
        content: 'Oi Maria, tudo bem?',
        message_type: 'template',
        whatsapp_message_id: 'wamid.1',
      })
    )
  })

  describe('cartão em "Mensagem lida" herda o follow-up de "Mensagem enviada"', () => {
    const boardStages = [
      { id: 'stage_sent', name: 'Mensagem enviada', position: 1 },
      { id: 'stage_read', name: 'Mensagem lida', position: 2 },
      { id: 'stage_stale', name: 'Sem resposta', position: 9 },
    ]
    const readCard = { ...baseCard, stage_id: 'stage_read', next_followup_index: 0 }

    function queueReadRound(sentRules: any[], settings: any = settingsOk) {
      kanbanCardsSelectFn.mockReturnValueOnce({ data: [readCard], error: null })
      followupRulesSelectFn.mockReturnValueOnce({ data: [], error: null }) // regras da própria fase "lida": nenhuma
      kanbanStagesSelectFn.mockReturnValueOnce({ data: boardStages, error: null })
      followupRulesSelectFn.mockReturnValueOnce({ data: sentRules, error: null }) // regras de "Mensagem enviada"
      automationSettingsSelectFn.mockReturnValueOnce({ data: settings, error: null })
      kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: readCard.id }], error: null })
      automationLogInsertFn.mockReturnValueOnce({ data: [], error: null })
      kanbanCardsSelectFn.mockReturnValueOnce({ data: { last_inbound_at: null }, error: null })
      contactsSelectFn.mockReturnValueOnce({ data: { id: 'contact_1', name: 'Maria Silva', phone: '+5511999999999' }, error: null })
    }

    it('envia o follow-up do dia 3 usando regras e modelo de "Mensagem enviada", contando do moved_at original', async () => {
      templateMapFn.mockResolvedValue({
        stage_sent: [{ templateName: 'marcoo_estetica_segundo_contato', language: 'pt_BR', alwaysSend: true }],
      })
      queueReadRound([{ id: 'rule_1', day_offset: 3, template_text: 'Oi {{nome}}' }])
      sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'wamid.2' })

      await runFollowupSweep(now)

      expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
        'tenant_1',
        expect.objectContaining({ type: 'template', templateName: 'marcoo_estetica_segundo_contato' })
      )
      expect(kanbanCardsUpdateFn).toHaveBeenCalledWith({ next_followup_index: 1 }, expect.objectContaining({ id: 'card_1' }))
    })

    it('antes do prazo (moved_at recente) não envia: o relógio não foi reiniciado pela leitura', async () => {
      kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ ...readCard, moved_at: '2026-07-19T10:00:00.000Z' }], error: null })
      followupRulesSelectFn.mockReturnValueOnce({ data: [], error: null })
      kanbanStagesSelectFn.mockReturnValueOnce({ data: boardStages, error: null })
      followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'x' }], error: null })
      automationSettingsSelectFn.mockReturnValueOnce({ data: settingsOk, error: null })

      await runFollowupSweep(now)
      expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
    })

    it('última regra enviada: cartão vai para "Sem resposta" (stale_stage_id do quadro)', async () => {
      templateMapFn.mockResolvedValue({
        stage_sent: [{ templateName: 'marcoo_estetica_segundo_contato', language: 'pt_BR', alwaysSend: true }],
      })
      queueReadRound([{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], { ...settingsOk, stale_stage_id: 'stage_stale' })
      sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'wamid.3' })

      await runFollowupSweep(now)

      expect(moveCardMock).toHaveBeenCalledWith('tenant_1', 'card_1', { stageId: 'stage_stale', position: 0 })
    })

    it('fase sem regras e que não é "Mensagem lida": continua sem enviar nada', async () => {
      kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ ...baseCard, stage_id: 'stage_other' }], error: null })
      followupRulesSelectFn.mockReturnValueOnce({ data: [], error: null })
      kanbanStagesSelectFn.mockReturnValueOnce({ data: boardStages, error: null })

      await runFollowupSweep(now)
      expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
    })
  })

  it('fora da janela de 24h SEM modelo: não envia e registra o motivo uma única vez', async () => {
    queueRound()
    await runFollowupSweep(now)
    queueRound()
    await runFollowupSweep(new Date(now.getTime() + 3600_000))

    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(
      '[Kanban] Follow-up não enviado:',
      expect.objectContaining({ reason: 'outside_24h_window_no_template' })
    )
  })

  it('modelo com problema (não aprovado): não envia', async () => {
    withTemplate()
    prepareTemplateFn.mockResolvedValue({ ok: false, reason: 'template_not_approved' })
    queueRound()
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('telefone suprimido (qualquer source): não envia', async () => {
    withTemplate()
    suppressionsFn.mockResolvedValue(new Map([['+5511999999999', { source: 'auto_failure_policy' }]]))
    queueRound()
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('erro ao consultar supressão: não envia (falha segura)', async () => {
    withTemplate()
    suppressionsFn.mockRejectedValue(new Error('db'))
    queueRound()
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('tenant bloqueado (trial/suspensão): não processa', async () => {
    withTemplate()
    isTenantBlockedFn.mockResolvedValue(true)
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('falha de envio: conta tentativas, não avança o índice, e desiste na 3ª com alerta', async () => {
    withTemplate()
    sendWhatsAppMessageMock.mockResolvedValue({ success: false, error: 'janela fechada' })

    for (let i = 0; i < 2; i++) {
      queueRound()
      await runFollowupSweep(now)
    }
    expect(kanbanCardsUpdateFn).not.toHaveBeenCalled()
    expect(notifyOpsAlertFn).not.toHaveBeenCalled()

    queueRound()
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(3)
    expect(kanbanCardsUpdateFn).toHaveBeenCalledWith({ next_followup_index: 1 }, expect.objectContaining({ id: 'card_1' }))
    expect(notifyOpsAlertFn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant_1', type: 'followup_gave_up' }))
  })

  it('prazo conta da ENTRADA na fase: inbound antigo não antecipa a regra', async () => {
    withTemplate()
    // entrou na fase há 1 dia; último inbound há 10 dias; regra de 3 dias => ainda não vence
    const card = { ...baseCard, moved_at: '2026-07-19T10:00:00.000Z', last_inbound_at: '2026-07-10T10:00:00.000Z' }
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [card], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'r', day_offset: 3, template_text: 'x' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({ data: settingsOk, error: null })
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('prazo vencido a partir da entrada na fase (3 dias): dispara', async () => {
    withTemplate()
    const card = { ...baseCard, moved_at: '2026-07-17T09:00:00.000Z' }
    queueRound(card)
    sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'w' })
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('uma vez por entrada na fase: regra já usada (índice 1 com 1 regra) não repete a cada hora', async () => {
    withTemplate()
    const card = { ...baseCard, next_followup_index: 1 }
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [card], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'r', day_offset: 3, template_text: 'x' }], error: null })
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('falha ao gravar no inbox não desfaz o envio', async () => {
    withTemplate()
    queueRound()
    sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'w' })
    getOrCreateConversationFn.mockRejectedValue(new Error('db'))
    await runFollowupSweep(now)
    expect(kanbanCardsUpdateFn).toHaveBeenCalledWith({ next_followup_index: 1 }, expect.anything())
  })

  it('fora da janela de horário: não envia', async () => {
    withTemplate()
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({ data: settingsOk, error: null })
    await runFollowupSweep(new Date('2026-07-20T03:00:00'))
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('cliente respondeu enquanto processava (race): revalidação aborta o envio', async () => {
    withTemplate()
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({ data: settingsOk, error: null })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: 'card_1' }], error: null })
    automationLogInsertFn.mockReturnValueOnce({ data: [], error: null })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: { last_inbound_at: '2026-07-20T09:59:00.000Z' }, error: null })
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('já houve follow-up pro mesmo contato em outro board nas últimas 24h: não duplica', async () => {
    withTemplate()
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [baseCard], error: null })
    followupRulesSelectFn.mockReturnValueOnce({ data: [{ id: 'rule_1', day_offset: 3, template_text: 'Oi' }], error: null })
    automationSettingsSelectFn.mockReturnValueOnce({ data: settingsOk, error: null })
    kanbanCardsSelectFn.mockReturnValueOnce({ data: [{ id: 'card_1' }, { id: 'card_2' }], error: null })
    automationLogInsertFn.mockReturnValueOnce({ data: [{ id: 'log_1' }], error: null })
    await runFollowupSweep(now)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('última regra + stale_stage_id configurado: move pro estágio frio', async () => {
    withTemplate()
    queueRound(baseCard, undefined, { ...settingsOk, stale_stage_id: 'stage_frio' })
    sendWhatsAppMessageMock.mockResolvedValueOnce({ success: true, messageId: 'wamid.1' })
    await runFollowupSweep(now)
    expect(moveCardMock).toHaveBeenCalledWith('tenant_1', 'card_1', { stageId: 'stage_frio', position: 0 })
  })
})
