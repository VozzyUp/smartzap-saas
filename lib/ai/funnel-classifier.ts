/**
 * Classificação do lead no funil (kanban) pela IA.
 *
 * O agente recebe os nomes das fases do quadro de funil do tenant como enum
 * (campo `funnelStage` da resposta estruturada). Depois da resposta,
 * `applyFunnelClassification` cria/move o card usando as funções de lib/kanban.ts
 * (que espelham a tag `funil/<quadro>: <fase>`).
 *
 * Tudo aqui é best-effort: falha NUNCA pode impedir a resposta ao lead.
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { listBoards, listStages, addCardToBoard, moveCard } from '@/lib/kanban'

/** Chave (tabela settings, PK tenant_id+key) do quadro de funil usado pela IA. */
export const AI_FUNNEL_BOARD_SETTING_KEY = 'ai_funnel_board_id'

export interface FunnelContext {
  boardId: string
  boardName: string
  stages: Array<{ id: string; name: string }>
  /** Nome da fase atual do contato neste quadro (null = ainda sem card). */
  currentStageName: string | null
}

export type FunnelApplyResult = 'created' | 'moved' | 'unchanged' | 'paused' | 'invalid_stage' | 'error'

function normalizeName(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

async function getConfiguredBoardId(tenantId: string): Promise<string | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  // settings tem PK (tenant_id, key): SEMPRE filtrar por tenant_id.
  const { data } = await admin
    .from('settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', AI_FUNNEL_BOARD_SETTING_KEY)
    .maybeSingle()
  const value = (data as { value?: string } | null)?.value
  return value ? String(value) : null
}

async function getContactCard(
  tenantId: string,
  boardId: string,
  contactId: string
): Promise<{ id: string; stage_id: string; automation_paused?: boolean } | null> {
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const { data } = await admin
    .from('kanban_cards')
    .select('id, stage_id, automation_paused')
    .eq('tenant_id', tenantId)
    .eq('board_id', boardId)
    .eq('contact_id', contactId)
    .maybeSingle()
  return (data as { id: string; stage_id: string; automation_paused?: boolean } | null) ?? null
}

/**
 * Descobre o quadro de funil e as fases. Retorna null (= não classificar) se:
 * não há contato, tenant sem quadro, mais de um quadro sem a setting
 * `ai_funnel_board_id`, setting apontando para quadro inexistente, quadro sem
 * fases ou qualquer erro.
 */
export async function resolveFunnelContext(
  tenantId: string,
  contactId: string | null | undefined
): Promise<FunnelContext | null> {
  if (!contactId) return null
  try {
    const boards = await listBoards(tenantId)
    if (boards.length === 0) return null

    const configuredId = await getConfiguredBoardId(tenantId)
    let board
    if (configuredId) {
      board = boards.find((b) => b.id === configuredId)
      if (!board) return null
    } else if (boards.length === 1) {
      board = boards[0]
    } else {
      return null
    }

    const stages = await listStages(tenantId, board.id)
    if (stages.length === 0) return null

    const card = await getContactCard(tenantId, board.id, contactId)
    const current = card ? stages.find((s) => s.id === card.stage_id) : undefined

    return {
      boardId: board.id,
      boardName: board.name,
      stages: stages.map((s) => ({ id: s.id, name: s.name })),
      currentStageName: current?.name ?? null,
    }
  } catch (err) {
    console.error('[funnel-classifier] falha ao resolver quadro de funil (ignorando classificação):', {
      tenantId,
      contactId,
      err,
    })
    return null
  }
}

/** Trecho do prompt de sistema montado pelo código (não pelo dono do agente). */
export function buildFunnelPromptSection(ctx: FunnelContext): string {
  const list = ctx.stages.map((s) => `- ${s.name}`).join('\n')
  return [
    `## Classificação no funil "${ctx.boardName}"`,
    `Fases disponíveis:\n${list}`,
    `Fase atual do lead: ${ctx.currentStageName ?? 'ainda não classificado'}.`,
    'No campo funnelStage da resposta, informe SEMPRE, em toda resposta, a fase em que o lead está DEPOIS ' +
      'desta mensagem, escolhendo pelo conteúdo da conversa inteira. Não deixe o campo vazio: se a fase ' +
      'não mudou, repita a fase atual. Assim que o lead responder qualquer coisa, ele já saiu das fases de ' +
      'entrada (novo contato, mensagem enviada) e deve ir para a fase de quem respondeu; quando demonstrar ' +
      'interesse, perguntar preço ou como funciona, vai para a fase de interesse; e assim por diante, ' +
      'seguindo os critérios das suas instruções. Você pode voltar o lead para uma fase anterior se a ' +
      'conversa indicar isso. Use null apenas se nenhuma fase da lista descrever o lead.',
  ].join('\n\n')
}

/**
 * Aplica a fase decidida pela IA. Nunca lança.
 * - sem card: cria já na fase indicada
 * - com card em outra fase: move (qualquer direção), exceto se automation_paused
 */
export async function applyFunnelClassification(
  tenantId: string,
  contactId: string,
  ctx: FunnelContext,
  stageName: string | null | undefined
): Promise<FunnelApplyResult> {
  if (!stageName || !stageName.trim()) return 'unchanged'

  const wanted = normalizeName(stageName)
  const stage = ctx.stages.find((s) => normalizeName(s.name) === wanted)
  if (!stage) {
    console.warn('[funnel-classifier] fase devolvida pelo modelo não existe no quadro (ignorada):', {
      tenantId,
      boardId: ctx.boardId,
      stageName,
    })
    return 'invalid_stage'
  }

  try {
    const card = await getContactCard(tenantId, ctx.boardId, contactId)

    if (!card) {
      await addCardToBoard(tenantId, ctx.boardId, contactId, stage.id)
      return 'created'
    }
    if (card.automation_paused) return 'paused'
    if (card.stage_id === stage.id) return 'unchanged'

    await moveCard(tenantId, card.id, { stageId: stage.id, position: 0 })
    return 'moved'
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'card_exists') return 'unchanged' // corrida
    console.error('[funnel-classifier] falha ao aplicar fase no kanban (resposta ao lead não é afetada):', {
      tenantId,
      contactId,
      boardId: ctx.boardId,
      stageName,
      err,
    })
    return 'error'
  }
}

// ---------------------------------------------------------------------------
// Pedido de saída (opt-out): cartão vai para a fase de "sem interesse"
// ---------------------------------------------------------------------------

export type NoInterestResult = FunnelApplyResult | 'no_funnel' | 'no_stage'

const NO_INTEREST_PATTERNS = ['sem interesse', 'nao tem interesse', 'perdid', 'nao quer', 'descartad']

/** Acha a fase de desinteresse pelo nome; com várias candidatas prefere a que contém "interesse". */
export function findNoInterestStage(
  stages: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const candidates = stages.filter((s) => {
    const n = normalizeName(s.name)
    return NO_INTEREST_PATTERNS.some((p) => n.includes(p))
  })
  if (candidates.length === 0) return null
  return candidates.find((s) => normalizeName(s.name).includes('interesse')) ?? candidates[0]
}

/**
 * Move o cartão do contato para a fase de desinteresse do quadro de funil da IA.
 * Best-effort: nunca lança. Sem fase candidata, não move nem cria fase.
 */
export async function moveContactToNoInterestStage(
  tenantId: string,
  contactId: string | null | undefined
): Promise<NoInterestResult> {
  try {
    const ctx = await resolveFunnelContext(tenantId, contactId)
    if (!ctx || !contactId) return 'no_funnel'
    const stage = findNoInterestStage(ctx.stages)
    if (!stage) {
      console.warn(
        `[funnel-classifier] pedido de saída: o quadro "${ctx.boardName}" não tem fase de "sem interesse" ` +
          '(nome com "sem interesse", "não tem interesse", "perdido", "não quer" ou "descartado"); cartão não movido.',
        { tenantId, boardId: ctx.boardId, contactId }
      )
      return 'no_stage'
    }
    return await applyFunnelClassification(tenantId, contactId, ctx, stage.name)
  } catch (err) {
    console.error('[funnel-classifier] falha ao mover cartão para sem interesse (ignorada):', { tenantId, contactId, err })
    return 'error'
  }
}

/** Variante por telefone (webhook): resolve o contato por tenant_id + telefone normalizado. */
export async function moveContactToNoInterestStageByPhone(
  tenantId: string,
  normalizedPhone: string
): Promise<NoInterestResult> {
  try {
    const admin = getSupabaseAdmin()
    if (!admin) return 'no_funnel'
    const { data } = await admin
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('phone', normalizedPhone)
      .limit(1)
      .maybeSingle()
    const id = (data as { id?: string } | null)?.id
    if (!id) return 'no_funnel'
    return await moveContactToNoInterestStage(tenantId, id)
  } catch (err) {
    console.error('[funnel-classifier] falha ao resolver contato por telefone (ignorada):', { tenantId, err })
    return 'error'
  }
}
