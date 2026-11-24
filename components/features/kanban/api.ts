import { api } from '@/lib/api'
import type { KanbanBoard, KanbanBoardData } from './types'

export async function listBoards(): Promise<KanbanBoard[]> {
  const data = await api.get<{ boards: KanbanBoard[] }>('/api/kanban/boards')
  return data.boards
}

export async function createBoard(name: string): Promise<KanbanBoard> {
  const data = await api.post<{ board: KanbanBoard }>('/api/kanban/boards', { name })
  return data.board
}

export async function renameBoard(boardId: string, name: string): Promise<void> {
  await api.patch(`/api/kanban/boards/${boardId}`, { name })
}

export async function deleteBoard(boardId: string): Promise<void> {
  await api.del(`/api/kanban/boards/${boardId}`)
}

export async function getBoardData(boardId: string): Promise<KanbanBoardData> {
  return api.get<KanbanBoardData>(`/api/kanban/boards/${boardId}/data`)
}

export async function createStage(
  boardId: string,
  params: { name: string; color: string }
): Promise<void> {
  await api.post(`/api/kanban/boards/${boardId}/stages`, params)
}

export async function updateStage(
  stageId: string,
  params: { name?: string; color?: string }
): Promise<void> {
  await api.patch(`/api/kanban/stages/${stageId}`, params)
}

export async function deleteStage(stageId: string): Promise<void> {
  await api.del(`/api/kanban/stages/${stageId}`)
}

export async function addCard(
  boardId: string,
  contactId: string,
  stageId?: string
): Promise<void> {
  await api.post(`/api/kanban/boards/${boardId}/cards`, { contactId, stageId })
}

export async function moveCard(
  cardId: string,
  params: { stageId: string; position: number }
): Promise<void> {
  await api.patch(`/api/kanban/cards/${cardId}`, params)
}

export async function removeCard(cardId: string): Promise<void> {
  await api.del(`/api/kanban/cards/${cardId}`)
}

export async function setCardAutomationPaused(cardId: string, paused: boolean): Promise<void> {
  await api.patch(`/api/kanban/cards/${cardId}`, { automationPaused: paused })
}

// ============================================================================
// Automação
// ============================================================================

export type AutomationEventType = 'message_sent' | 'client_replied' | 'quote_detected'

export type BoardAutomationConfig = {
  automations: Partial<Record<AutomationEventType, { targetStageId: string; active: boolean }>>
  settings: {
    windowStart: string
    windowEnd: string
    weekdaysMask: number
    staleStageId: string | null
  } | null
}

export async function getBoardAutomationConfig(boardId: string): Promise<BoardAutomationConfig> {
  return api.get<BoardAutomationConfig>(`/api/kanban/boards/${boardId}/automation`)
}

export async function saveBoardAutomationConfig(
  boardId: string,
  config: {
    automations: Partial<Record<AutomationEventType, { targetStageId: string; active: boolean } | null>>
    settings: { windowStart: string; windowEnd: string; weekdaysMask: number; staleStageId: string | null }
  }
): Promise<void> {
  await api.patch(`/api/kanban/boards/${boardId}/automation`, config)
}

export type FollowupTemplate = {
  templateName: string
  language: string
  /** Valores das variáveis do corpo, na ordem. "{{nome}}" = primeiro nome do contato; o resto é texto fixo. */
  bodyParams?: string[]
  /** Envia o modelo mesmo dentro da janela de 24 h. */
  alwaysSend?: boolean
}

export type FollowupRule = {
  id?: string
  dayOffset: number
  templateText: string
  position: number
  template?: FollowupTemplate | null
}

export type ApprovedTemplate = { name: string; language: string; bodyText: string; variableCount: number }

/** Modelos aprovados já sincronizados (sem chamar a Meta). */
export async function listApprovedTemplates(): Promise<ApprovedTemplate[]> {
  const data = await api.get<Array<{ name: string; language: string; status: string; content?: string; components?: Array<{ type: string; text?: string }> }>>(
    '/api/templates?source=local'
  )
  return (Array.isArray(data) ? data : [])
    .filter((t) => String(t.status).toUpperCase() === 'APPROVED')
    .map((t) => {
      const bodyText = t.components?.find((c) => String(c.type).toUpperCase() === 'BODY')?.text ?? t.content ?? ''
      const nums = new Set(Array.from(bodyText.matchAll(/{{s*(d+)s*}}/g)).map((m) => m[1]))
      return { name: t.name, language: t.language || 'pt_BR', bodyText, variableCount: nums.size }
    })
}

export async function listFollowupRules(stageId: string): Promise<FollowupRule[]> {
  const data = await api.get<{ rules: FollowupRule[] }>(`/api/kanban/stages/${stageId}/followup-rules`)
  return data.rules
}

export async function saveFollowupRules(stageId: string, rules: FollowupRule[]): Promise<void> {
  await api.patch(`/api/kanban/stages/${stageId}/followup-rules`, { rules })
}

export type QuoteKeyword = { id: string; keyword: string }

export async function listQuoteKeywords(): Promise<QuoteKeyword[]> {
  const data = await api.get<{ keywords: QuoteKeyword[] }>('/api/kanban/quote-keywords')
  return data.keywords
}

export async function addQuoteKeyword(keyword: string): Promise<QuoteKeyword> {
  const data = await api.post<{ keyword: QuoteKeyword }>('/api/kanban/quote-keywords', { keyword })
  return data.keyword
}

export async function removeQuoteKeyword(keywordId: string): Promise<void> {
  await api.del(`/api/kanban/quote-keywords/${keywordId}`)
}

export type CardAutomationLogEntry = {
  id: string
  eventType: 'stage_moved' | 'followup_sent'
  source: 'ai' | 'keyword' | 'system' | 'manual'
  detail: Record<string, unknown>
  createdAt: string
}

export async function listCardAutomationLog(cardId: string): Promise<CardAutomationLogEntry[]> {
  const data = await api.get<{ log: CardAutomationLogEntry[] }>(`/api/kanban/cards/${cardId}/automation-log`)
  return data.log
}
