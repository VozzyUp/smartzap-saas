import { getSupabaseAdmin } from '@/lib/supabase'
import { addCardToBoard, moveCard, KanbanError, type KanbanCard, type KanbanStage } from '@/lib/kanban'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'

export type AutomationEventType = 'message_sent' | 'client_replied' | 'quote_detected'
export type AutomationSource = 'ai' | 'keyword' | 'system' | 'manual'

function db() {
  return getSupabaseAdmin()!
}

// ============================================================================
// PURE HELPERS (testáveis sem mock de DB)
// ============================================================================

/**
 * Bitmask dom..sab (bit 0 = domingo .. bit 6 = sábado) — mesmo formato
 * armazenado em kanban_automation_settings.weekdays_mask.
 */
export function isWithinFollowupWindow(
  now: Date,
  settings: { window_start: string; window_end: string; weekdays_mask: number }
): boolean {
  const weekday = now.getDay() // 0 = domingo
  if (((settings.weekdays_mask >> weekday) & 1) === 0) return false

  const [startH, startM] = settings.window_start.split(':').map(Number)
  const [endH, endM] = settings.window_end.split(':').map(Number)
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const minutesStart = startH * 60 + startM
  const minutesEnd = endH * 60 + endM

  return minutesNow >= minutesStart && minutesNow < minutesEnd
}

export function shouldTriggerFollowup(now: Date, lastActivityAt: Date, dayOffset: number): boolean {
  const elapsedMs = now.getTime() - lastActivityAt.getTime()
  const thresholdMs = dayOffset * 24 * 60 * 60 * 1000
  return elapsedMs >= thresholdMs
}

export function substituteTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match)
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(text)
  return keywords.some((k) => normalized.includes(normalizeForMatch(k)))
}

// ============================================================================
// triggerAutomationEvent
// ============================================================================

export async function triggerAutomationEvent(
  tenantId: string,
  contactId: string,
  eventType: AutomationEventType,
  source: AutomationSource
): Promise<void> {
  const { data: automations, error } = await db()
    .from('kanban_board_automations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('event_type', eventType)
    .eq('active', true)
  if (error) throw error
  if (!automations || automations.length === 0) return

  for (const automation of automations as any[]) {
    await applyAutomation(tenantId, contactId, automation, source)
  }
}

async function applyAutomation(
  tenantId: string,
  contactId: string,
  automation: { board_id: string; target_stage_id: string },
  source: AutomationSource
): Promise<void> {
  const { data: existingCard } = await db()
    .from('kanban_cards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', automation.board_id)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (!existingCard) {
    let card: KanbanCard
    try {
      card = await addCardToBoard(tenantId, automation.board_id, contactId, automation.target_stage_id)
    } catch (e) {
      if (e instanceof KanbanError && e.code === 'card_exists') return // corrida: outro evento criou entre a leitura e agora
      throw e
    }
    await logAutomationEvent(tenantId, card.id, 'stage_moved', source, { target_stage_id: automation.target_stage_id })
    return
  }

  const card = existingCard as KanbanCard & { automation_paused: boolean }
  if (card.automation_paused) return
  if (card.stage_id === automation.target_stage_id) return

  const [{ data: currentStage }, { data: targetStage }] = await Promise.all([
    db().from('kanban_stages').select('*').eq('tenant_id', tenantId).eq('id', card.stage_id).maybeSingle(),
    db().from('kanban_stages').select('*').eq('tenant_id', tenantId).eq('id', automation.target_stage_id).maybeSingle(),
  ])
  const current = currentStage as KanbanStage | null
  const target = targetStage as KanbanStage | null
  if (!current || !target) return

  // Regra anti-cabo-de-guerra: automação nunca move o card pra trás.
  if (target.position <= current.position) return

  await moveCard(tenantId, card.id, { stageId: automation.target_stage_id, position: 0 })
  await logAutomationEvent(tenantId, card.id, 'stage_moved', source, {
    from_stage_id: current.id,
    target_stage_id: automation.target_stage_id,
  })
}

async function logAutomationEvent(
  tenantId: string,
  cardId: string,
  eventType: 'stage_moved' | 'followup_sent',
  source: AutomationSource,
  detail: Record<string, unknown>
): Promise<void> {
  await db().from('kanban_card_automation_log').insert({
    tenant_id: tenantId,
    card_id: cardId,
    event_type: eventType,
    source,
    detail,
  })
}

// ============================================================================
// Configuração: mapeamento evento → coluna + janela de horário (painel do board)
// ============================================================================

export type BoardAutomationConfig = {
  automations: Partial<Record<AutomationEventType, { targetStageId: string; active: boolean }>>
  settings: {
    windowStart: string
    windowEnd: string
    weekdaysMask: number
    staleStageId: string | null
  } | null
}

export async function getBoardAutomationConfig(tenantId: string, boardId: string): Promise<BoardAutomationConfig> {
  const [{ data: automations }, { data: settings }] = await Promise.all([
    db().from('kanban_board_automations').select('*').eq('tenant_id', tenantId).eq('board_id', boardId),
    db().from('kanban_automation_settings').select('*').eq('tenant_id', tenantId).eq('board_id', boardId).maybeSingle(),
  ])

  const config: BoardAutomationConfig['automations'] = {}
  for (const row of (automations as any[]) ?? []) {
    config[row.event_type as AutomationEventType] = { targetStageId: row.target_stage_id, active: row.active }
  }

  return {
    automations: config,
    settings: settings
      ? {
          windowStart: (settings as any).window_start,
          windowEnd: (settings as any).window_end,
          weekdaysMask: (settings as any).weekdays_mask,
          staleStageId: (settings as any).stale_stage_id,
        }
      : null,
  }
}

export async function saveBoardAutomationConfig(
  tenantId: string,
  boardId: string,
  config: {
    automations: Partial<Record<AutomationEventType, { targetStageId: string; active: boolean } | null>>
    settings: { windowStart: string; windowEnd: string; weekdaysMask: number; staleStageId: string | null }
  }
): Promise<void> {
  for (const [eventType, value] of Object.entries(config.automations)) {
    if (!value) {
      await db().from('kanban_board_automations').delete().eq('tenant_id', tenantId).eq('board_id', boardId).eq('event_type', eventType)
      continue
    }
    await db().from('kanban_board_automations').upsert(
      {
        tenant_id: tenantId,
        board_id: boardId,
        event_type: eventType,
        target_stage_id: value.targetStageId,
        active: value.active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'board_id,event_type' }
    )
  }

  await db().from('kanban_automation_settings').upsert(
    {
      tenant_id: tenantId,
      board_id: boardId,
      window_start: config.settings.windowStart,
      window_end: config.settings.windowEnd,
      weekdays_mask: config.settings.weekdaysMask,
      stale_stage_id: config.settings.staleStageId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'board_id' }
  )
}

// ============================================================================
// Regras de follow-up por estágio
// ============================================================================

export type FollowupRule = { id?: string; dayOffset: number; templateText: string; position: number }

export async function listFollowupRules(tenantId: string, stageId: string): Promise<FollowupRule[]> {
  const { data } = await db()
    .from('kanban_stage_followup_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('stage_id', stageId)
    .eq('active', true)
    .order('position', { ascending: true })
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    dayOffset: r.day_offset,
    templateText: r.template_text,
    position: r.position,
  }))
}

/** Substitui TODAS as regras do estágio pela lista enviada (editor "salva tudo de uma vez"). */
export async function saveFollowupRules(tenantId: string, stageId: string, rules: FollowupRule[]): Promise<void> {
  await db().from('kanban_stage_followup_rules').delete().eq('tenant_id', tenantId).eq('stage_id', stageId)
  if (rules.length === 0) return

  await db()
    .from('kanban_stage_followup_rules')
    .insert(
      rules.map((r, i) => ({
        tenant_id: tenantId,
        stage_id: stageId,
        day_offset: r.dayOffset,
        template_text: r.templateText,
        position: i,
        active: true,
      }))
    )
}

// ============================================================================
// Palavras-chave de orçamento
// ============================================================================

export type QuoteKeyword = { id: string; keyword: string }

export async function listQuoteKeywords(tenantId: string): Promise<QuoteKeyword[]> {
  const { data } = await db().from('kanban_quote_keywords').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true })
  return ((data as any[]) ?? []).map((k) => ({ id: k.id, keyword: k.keyword }))
}

export async function addQuoteKeyword(tenantId: string, keyword: string): Promise<QuoteKeyword> {
  const { data, error } = await db()
    .from('kanban_quote_keywords')
    .insert({ tenant_id: tenantId, keyword: keyword.trim() })
    .select('*')
    .single()
  if (error) throw error
  return { id: (data as any).id, keyword: (data as any).keyword }
}

export async function removeQuoteKeyword(tenantId: string, keywordId: string): Promise<void> {
  await db().from('kanban_quote_keywords').delete().eq('tenant_id', tenantId).eq('id', keywordId)
}

// ============================================================================
// Kill switch por card + timeline
// ============================================================================

export async function setCardAutomationPaused(tenantId: string, cardId: string, paused: boolean): Promise<void> {
  await db().from('kanban_cards').update({ automation_paused: paused }).eq('tenant_id', tenantId).eq('id', cardId)
}

export type CardAutomationLogEntry = {
  id: string
  eventType: 'stage_moved' | 'followup_sent'
  source: AutomationSource
  detail: Record<string, unknown>
  createdAt: string
}

export async function listCardAutomationLog(tenantId: string, cardId: string): Promise<CardAutomationLogEntry[]> {
  const { data } = await db()
    .from('kanban_card_automation_log')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('card_id', cardId)
    .order('created_at', { ascending: false })
  return ((data as any[]) ?? []).map((e) => ({
    id: e.id,
    eventType: e.event_type,
    source: e.source,
    detail: e.detail,
    createdAt: e.created_at,
  }))
}

// ============================================================================
// recordInboundActivity
// ============================================================================

/**
 * Chamado a cada resposta do cliente — usado pelo sweep de follow-up pra
 * saber há quanto tempo o contato está em silêncio, e pela revalidação de
 * corrida (cliente respondeu enquanto o sweep processava).
 */
export async function recordInboundActivity(tenantId: string, contactId: string, now: Date = new Date()): Promise<void> {
  await db()
    .from('kanban_cards')
    .update({ last_inbound_at: now.toISOString() })
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
}

// ============================================================================
// detectQuoteKeyword
// ============================================================================

export async function detectQuoteKeyword(tenantId: string, text: string): Promise<boolean> {
  const { data: keywords, error } = await db()
    .from('kanban_quote_keywords')
    .select('keyword')
    .eq('tenant_id', tenantId)
  if (error) throw error
  if (!keywords || keywords.length === 0) return false
  return matchesAnyKeyword(text, (keywords as any[]).map((k) => k.keyword))
}

// ============================================================================
// runFollowupSweep
// ============================================================================

type FollowupCandidate = {
  id: string
  tenant_id: string
  board_id: string
  stage_id: string
  contact_id: string
  moved_at: string
  last_inbound_at: string | null
  next_followup_index: number
}

export async function runFollowupSweep(now: Date = new Date()): Promise<void> {
  const { data: candidates, error } = await db()
    .from('kanban_cards')
    .select('*')
    .eq('automation_paused', false)
  if (error) throw error
  if (!candidates || candidates.length === 0) return

  for (const card of candidates as FollowupCandidate[]) {
    await processFollowupCandidate(card, now)
  }
}

async function processFollowupCandidate(card: FollowupCandidate, now: Date): Promise<void> {
  const { data: rules } = await db()
    .from('kanban_stage_followup_rules')
    .select('*')
    .eq('stage_id', card.stage_id)
    .eq('active', true)
    .order('position', { ascending: true })
  const rule = (rules as any[] | null)?.[card.next_followup_index]
  if (!rule) return

  const { data: settings } = await db()
    .from('kanban_automation_settings')
    .select('*')
    .eq('board_id', card.board_id)
    .maybeSingle()
  if (settings && !isWithinFollowupWindow(now, settings as any)) return

  const lastActivity = new Date(card.last_inbound_at ?? card.moved_at)
  if (!shouldTriggerFollowup(now, lastActivity, rule.day_offset)) return

  // Dedup entre boards: evita que o mesmo contato receba mais de um follow-up
  // por dia, mesmo que esteja em vários boards com automação configurada.
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data: contactCards } = await db()
    .from('kanban_cards')
    .select('id')
    .eq('tenant_id', card.tenant_id)
    .eq('contact_id', card.contact_id)
  const contactCardIds = ((contactCards as any[] | null) ?? []).map((c) => c.id)
  if (contactCardIds.length > 0) {
    const { data: recentSent } = await db()
      .from('kanban_card_automation_log')
      .select('id')
      .eq('event_type', 'followup_sent')
      .in('card_id', contactCardIds)
      .gte('created_at', since24h)
      .limit(1)
    if (recentSent && recentSent.length > 0) return
  }

  // Revalida last_inbound_at imediatamente antes de enviar — mitiga a corrida
  // "cliente respondeu enquanto o sweep processava" sem lock distribuído.
  const { data: freshCard } = await db()
    .from('kanban_cards')
    .select('last_inbound_at')
    .eq('id', card.id)
    .maybeSingle()
  if ((freshCard as any)?.last_inbound_at !== card.last_inbound_at) return

  const { data: contact } = await db()
    .from('contacts')
    .select('id, name, phone')
    .eq('id', card.contact_id)
    .maybeSingle()
  if (!contact) return

  const message = substituteTemplate(rule.template_text, { nome: (contact as any).name })
  const result = await sendWhatsAppMessage(card.tenant_id, { to: (contact as any).phone, type: 'text', text: message })
  if (!result.success) return

  await logAutomationEvent(card.tenant_id, card.id, 'followup_sent', 'system', {
    rule_id: rule.id,
    message_id: result.messageId,
  })

  const nextIndex = card.next_followup_index + 1
  const isLastRule = nextIndex >= (rules as any[]).length
  if (isLastRule && settings && (settings as any).stale_stage_id) {
    await moveCard(card.tenant_id, card.id, { stageId: (settings as any).stale_stage_id, position: 0 })
    await logAutomationEvent(card.tenant_id, card.id, 'stage_moved', 'system', {
      target_stage_id: (settings as any).stale_stage_id,
      reason: 'followups_exhausted',
    })
  } else {
    await db().from('kanban_cards').update({ next_followup_index: nextIndex }).eq('id', card.id)
  }
}
