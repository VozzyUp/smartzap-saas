import { getSupabaseAdmin } from '@/lib/supabase'

// ============================================================================
// TYPES
// ============================================================================

export type KanbanBoard = {
  id: string
  tenant_id: string
  name: string
  position: number
}

export type KanbanStage = {
  id: string
  tenant_id: string
  board_id: string
  name: string
  color: string
  position: number
  wa_label_id?: string | null
}

export type KanbanCard = {
  id: string
  tenant_id: string
  board_id: string
  stage_id: string
  contact_id: string
  position: number
  created_at: string
  moved_at: string
}

export type KanbanBoardData = {
  board: KanbanBoard
  stages: (KanbanStage & {
    cards: (KanbanCard & { contact: { id: string; name: string | null; phone: string | null } })[]
  })[]
}

export type ContactStageInfo = {
  boardId: string
  boardName: string
  stageId: string
  stageName: string
  stageColor: string
  cardId: string
}

// ============================================================================
// ERRORS
// ============================================================================

export class KanbanError extends Error {
  code: 'card_exists' | 'stage_has_cards' | 'invalid_stage' | 'not_found'

  constructor(code: KanbanError['code'], message?: string) {
    super(message ?? code)
    this.name = 'KanbanError'
    this.code = code
  }
}

const DEFAULT_STAGES: { name: string; color: string }[] = [
  { name: 'Novo', color: '#3b82f6' },
  { name: 'Em andamento', color: '#f59e0b' },
  { name: 'Concluído', color: '#22c55e' },
]

function db() {
  return getSupabaseAdmin()!
}

// ============================================================================
// BOARDS
// ============================================================================

export async function listBoards(tenantId: string): Promise<KanbanBoard[]> {
  const { data, error } = await db()
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as KanbanBoard[]) ?? []
}

export async function createBoard(tenantId: string, name: string): Promise<KanbanBoard> {
  const { data: board, error } = await db()
    .from('kanban_boards')
    .insert({ tenant_id: tenantId, name, position: 0 })
    .select('*')
    .single()
  if (error) throw error

  const stagesToInsert = DEFAULT_STAGES.map((s, i) => ({
    tenant_id: tenantId,
    board_id: board.id,
    name: s.name,
    color: s.color,
    position: i,
  }))
  const { error: stagesError } = await db().from('kanban_stages').insert(stagesToInsert)
  if (stagesError) throw stagesError

  return board as KanbanBoard
}

export async function renameBoard(tenantId: string, boardId: string, name: string): Promise<void> {
  // Carrega o nome antigo antes do update: as tags espelhadas usam o nome do
  // board (`funil/<board>: <fase>`), então renomear o board precisa migrar as
  // tags dos contatos do quadro (senão o filtro de campanha quebra em silêncio).
  const { data: board } = await db()
    .from('kanban_boards')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', boardId)
    .maybeSingle()
  if (!board) throw new KanbanError('not_found')
  const oldName = (board as any).name as string

  const { error } = await db()
    .from('kanban_boards')
    .update({ name })
    .eq('tenant_id', tenantId)
    .eq('id', boardId)
  if (error) throw error

  if (oldName === name) return

  // Migra as tags: remove `funil/<antigo>: <fase>` e adiciona `funil/<novo>: <fase>`
  // por card (best-effort, como todo syncStageTag).
  const { data: stages } = await db()
    .from('kanban_stages')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
  const stageNameById = new Map(((stages ?? []) as any[]).map((s) => [s.id, s.name as string]))

  const { data: cards } = await db()
    .from('kanban_cards')
    .select('contact_id, stage_id')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)

  for (const card of (cards ?? []) as any[]) {
    const stageName = stageNameById.get(card.stage_id)
    if (!stageName) continue
    await syncStageTag(tenantId, card.contact_id, oldName, stageName, null)
    await syncStageTag(tenantId, card.contact_id, name, null, stageName)
  }
}

export async function deleteBoard(tenantId: string, boardId: string): Promise<void> {
  const { data: board } = await db()
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', boardId)
    .maybeSingle()
  if (!board) throw new KanbanError('not_found')

  const { data: stages } = await db()
    .from('kanban_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
  const stageNameById = new Map<string, string>((stages ?? []).map((s: any) => [s.id, s.name]))

  const { data: cards } = await db()
    .from('kanban_cards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)

  for (const card of (cards ?? []) as any[]) {
    await syncStageTag(tenantId, card.contact_id, board.name, stageNameById.get(card.stage_id) ?? null, null)
  }

  const { error } = await db().from('kanban_boards').delete().eq('tenant_id', tenantId).eq('id', boardId)
  if (error) throw error
}

// ============================================================================
// STAGES
// ============================================================================

export async function listStages(tenantId: string, boardId: string): Promise<KanbanStage[]> {
  const { data, error } = await db()
    .from('kanban_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as KanbanStage[]) ?? []
}

export async function createStage(
  tenantId: string,
  boardId: string,
  params: { name: string; color: string }
): Promise<KanbanStage> {
  const { data: last } = await db()
    .from('kanban_stages')
    .select('position')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const position = last ? (last as any).position + 1 : 0

  const { data, error } = await db()
    .from('kanban_stages')
    .insert({ tenant_id: tenantId, board_id: boardId, name: params.name, color: params.color, position })
    .select('*')
    .single()
  if (error) throw error
  return data as KanbanStage
}

export async function updateStage(
  tenantId: string,
  stageId: string,
  params: { name?: string; color?: string }
): Promise<void> {
  const { data: stage } = await db()
    .from('kanban_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', stageId)
    .maybeSingle()
  if (!stage) throw new KanbanError('not_found')

  const patch: Record<string, unknown> = {}
  if (params.name !== undefined) patch.name = params.name
  if (params.color !== undefined) patch.color = params.color

  if (Object.keys(patch).length > 0) {
    const { error } = await db().from('kanban_stages').update(patch).eq('tenant_id', tenantId).eq('id', stageId)
    if (error) throw error
  }

  const renamed = params.name !== undefined && params.name !== (stage as any).name
  if (renamed) {
    const { data: board } = await db()
      .from('kanban_boards')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', (stage as any).board_id)
      .maybeSingle()
    const { data: cards } = await db()
      .from('kanban_cards')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('stage_id', stageId)

    for (const card of (cards ?? []) as any[]) {
      await syncStageTag(tenantId, card.contact_id, (board as any)?.name ?? '', (stage as any).name, params.name!)
    }
  }
}

export async function reorderStages(tenantId: string, boardId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await db()
      .from('kanban_stages')
      .update({ position: i })
      .eq('tenant_id', tenantId)
      .eq('id', orderedIds[i])
    if (error) throw error
  }
}

export async function deleteStage(tenantId: string, stageId: string): Promise<void> {
  const { count, error: countError } = await db()
    .from('kanban_cards')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('stage_id', stageId)
  if (countError) throw countError
  if ((count ?? 0) > 0) throw new KanbanError('stage_has_cards')

  const { error } = await db().from('kanban_stages').delete().eq('tenant_id', tenantId).eq('id', stageId)
  if (error) throw error
}

// ============================================================================
// BOARD DATA
// ============================================================================

export async function getBoardData(tenantId: string, boardId: string): Promise<KanbanBoardData | null> {
  const { data: board } = await db()
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', boardId)
    .maybeSingle()
  if (!board) return null

  const { data: stages } = await db()
    .from('kanban_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
    .order('position', { ascending: true })

  const { data: cards } = await db()
    .from('kanban_cards')
    .select('*, contact:contacts(id,name,phone)')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
    .order('position', { ascending: true })

  const cardsByStage = new Map<string, any[]>()
  for (const card of (cards ?? []) as any[]) {
    const list = cardsByStage.get(card.stage_id) ?? []
    list.push(card)
    cardsByStage.set(card.stage_id, list)
  }

  return {
    board: board as KanbanBoard,
    stages: ((stages ?? []) as any[]).map((s) => ({ ...s, cards: cardsByStage.get(s.id) ?? [] })),
  } as KanbanBoardData
}

// ============================================================================
// CARDS
// ============================================================================

export async function addCardToBoard(
  tenantId: string,
  boardId: string,
  contactId: string,
  stageId?: string
): Promise<KanbanCard> {
  const { data: board } = await db()
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', boardId)
    .maybeSingle()
  if (!board) throw new KanbanError('not_found')

  // Guard de posse: o contato precisa ser DESTE tenant. Sem isso, um contactId
  // de outro tenant entraria no quadro e o join de getBoardData exporia
  // nome/telefone alheios (service role bypassa RLS).
  const { data: contact } = await db()
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) throw new KanbanError('not_found')

  let targetStageId = stageId
  let targetStageName: string

  if (targetStageId) {
    const { data: stage } = await db()
      .from('kanban_stages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', targetStageId)
      .maybeSingle()
    if (!stage || (stage as any).board_id !== boardId) throw new KanbanError('invalid_stage')
    targetStageName = (stage as any).name
  } else {
    const { data: firstStage } = await db()
      .from('kanban_stages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('board_id', boardId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!firstStage) throw new KanbanError('invalid_stage')
    targetStageId = (firstStage as any).id
    targetStageName = (firstStage as any).name
  }

  const { data: card, error } = await db()
    .from('kanban_cards')
    .insert({ tenant_id: tenantId, board_id: boardId, stage_id: targetStageId, contact_id: contactId, position: 0 })
    .select('*')
    .single()

  if (error) {
    if ((error as any).code === '23505') throw new KanbanError('card_exists')
    throw error
  }

  await syncStageTag(tenantId, contactId, (board as any).name, null, targetStageName)

  return card as KanbanCard
}

export async function moveCard(
  tenantId: string,
  cardId: string,
  params: { stageId: string; position: number }
): Promise<void> {
  const { data: card } = await db()
    .from('kanban_cards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', cardId)
    .maybeSingle()
  if (!card) throw new KanbanError('not_found')

  const { data: targetStage } = await db()
    .from('kanban_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', params.stageId)
    .maybeSingle()
  if (!targetStage || (targetStage as any).board_id !== (card as any).board_id) {
    throw new KanbanError('invalid_stage')
  }

  const stageChanged = (card as any).stage_id !== params.stageId
  let oldStageName: string | null = null
  let boardName = ''

  if (stageChanged) {
    const { data: oldStage } = await db()
      .from('kanban_stages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', (card as any).stage_id)
      .maybeSingle()
    oldStageName = (oldStage as any)?.name ?? null

    const { data: board } = await db()
      .from('kanban_boards')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', (card as any).board_id)
      .maybeSingle()
    boardName = (board as any)?.name ?? ''
  }

  const { error } = await db()
    .from('kanban_cards')
    .update({
      stage_id: params.stageId,
      position: params.position,
      moved_at: new Date().toISOString(),
      // Sair do estágio cancela a sequência de follow-up daquele estágio —
      // sem isso um card que já avançou (cliente respondeu) ainda recebe
      // "sumiu?" do estágio anterior no próximo sweep.
      ...(stageChanged ? { next_followup_index: 0 } : {}),
    })
    .eq('tenant_id', tenantId)
    .eq('id', cardId)
  if (error) throw error

  if (stageChanged) {
    await syncStageTag(tenantId, (card as any).contact_id, boardName, oldStageName, (targetStage as any).name)
  }
}

export async function removeCard(tenantId: string, cardId: string): Promise<void> {
  const { data: card } = await db()
    .from('kanban_cards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', cardId)
    .maybeSingle()
  if (!card) throw new KanbanError('not_found')

  const { error } = await db().from('kanban_cards').delete().eq('tenant_id', tenantId).eq('id', cardId)
  if (error) throw error

  const { data: stage } = await db()
    .from('kanban_stages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', (card as any).stage_id)
    .maybeSingle()
  const { data: board } = await db()
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', (card as any).board_id)
    .maybeSingle()

  await syncStageTag(tenantId, (card as any).contact_id, (board as any)?.name ?? '', (stage as any)?.name ?? null, null)
}

export async function getContactStages(tenantId: string, contactId: string): Promise<ContactStageInfo[]> {
  const { data: cards } = await db()
    .from('kanban_cards')
    .select('*, board:kanban_boards(id,name), stage:kanban_stages(id,name,color)')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)

  return ((cards ?? []) as any[]).map((c) => ({
    boardId: c.board?.id ?? c.board_id,
    boardName: c.board?.name ?? '',
    stageId: c.stage?.id ?? c.stage_id,
    stageName: c.stage?.name ?? '',
    stageColor: c.stage?.color ?? '#64748b',
    cardId: c.id,
  }))
}

// ============================================================================
// TAG ESPELHADA
// ============================================================================

/**
 * Sincroniza a tag espelhada `funil/<board>: <fase>` em `contacts.tags`.
 *
 * Best-effort: nunca lança. Falha de sincronização de tag não pode desfazer
 * uma operação de kanban já efetivada (mover/remover card).
 */
export async function syncStageTag(
  tenantId: string,
  contactId: string,
  boardName: string,
  oldStageName: string | null,
  newStageName: string | null
): Promise<void> {
  try {
    const { data: contact, error } = await db()
      .from('contacts')
      .select('tags')
      .eq('tenant_id', tenantId)
      .eq('id', contactId)
      .maybeSingle()
    if (error) throw error
    if (!contact) return

    let tags: string[] = Array.isArray((contact as any).tags) ? [...(contact as any).tags] : []

    if (oldStageName) {
      const oldTag = `funil/${boardName}: ${oldStageName}`
      tags = tags.filter((t) => t !== oldTag)
    }
    if (newStageName) {
      const newTag = `funil/${boardName}: ${newStageName}`
      if (!tags.includes(newTag)) tags.push(newTag)
    }

    const { error: updateError } = await db()
      .from('contacts')
      .update({ tags })
      .eq('tenant_id', tenantId)
      .eq('id', contactId)
    if (updateError) throw updateError
  } catch (err) {
    console.warn('[syncStageTag] falha ao sincronizar tag de funil (best-effort):', err)
  }
}
