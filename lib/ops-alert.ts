/**
 * Alerta operacional: avisa o tenant quando algo que deveria acontecer sozinho
 * (receber lead, acionar IA, responder) falhou e o lead pode ter ficado sem resposta.
 *
 * Regras:
 * - Sempre loga com contexto estruturado (tenantId, conversationId, tipo). Nunca
 *   inclui conteúdo de mensagem, telefone, token ou chave: só a mensagem do erro, truncada.
 * - Push para os usuários do tenant com limite de 1 alerta do mesmo tipo por tenant
 *   a cada 10 minutos (Redis SET NX EX; sem Redis, memória do processo).
 * - Nunca lança: é chamado dentro de blocos catch.
 */

import { redis } from '@/lib/redis'
import { broadcastPushNotificationToTenant } from '@/lib/push-notifications'
import { inboxDb } from '@/lib/inbox/inbox-db'

export type OpsAlertType =
  | 'inbox_save_failed'
  | 'ai_queue_failed'
  | 'ai_send_failed'
  | 'ai_no_agent'
  | 'webhook_error'
  | 'followup_gave_up'

const ALERT_COPY: Record<OpsAlertType, { title: string; body: string }> = {
  inbox_save_failed: {
    title: 'Mensagem de cliente não foi salva',
    body: 'Uma mensagem recebida pelo WhatsApp não foi gravada no atendimento. Confira o WhatsApp do celular.',
  },
  ai_queue_failed: {
    title: 'Robô não foi acionado',
    body: 'Uma conversa não conseguiu entrar na fila do robô. Ela foi passada para atendimento humano.',
  },
  ai_send_failed: {
    title: 'Robô não conseguiu responder',
    body: 'A resposta do robô não foi entregue pelo WhatsApp. A conversa foi passada para atendimento humano.',
  },
  ai_no_agent: {
    title: 'Sem agente de IA ativo',
    body: 'Chegou uma conversa e não há agente de IA ativo. Ela foi passada para atendimento humano.',
  },
  webhook_error: {
    title: 'Erro ao processar o WhatsApp',
    body: 'Houve um erro ao processar eventos do WhatsApp. Alguma mensagem pode ter se perdido.',
  },
  followup_gave_up: {
    title: 'Acompanhamento automático desistiu',
    body: 'Um acompanhamento automático falhou várias vezes e foi interrompido para um contato.',
  },
}

export const OPS_ALERT_WINDOW_SECONDS = 600

const memory = new Map<string, number>()

export function __resetOpsAlertMemory(): void {
  memory.clear()
}

/** true = pode enviar push agora (e marca a janela). */
async function acquireWindow(tenantId: string, type: OpsAlertType): Promise<boolean> {
  const key = `ops-alert:${tenantId}:${type}`
  if (redis) {
    try {
      const r = await redis.set(key, '1', { nx: true, ex: OPS_ALERT_WINDOW_SECONDS })
      return r !== null && r !== undefined
    } catch {
      // cai para memória
    }
  }
  const now = Date.now()
  const until = memory.get(key)
  if (until && until > now) return false
  memory.set(key, now + OPS_ALERT_WINDOW_SECONDS * 1000)
  return true
}

function errorText(error: unknown): string | null {
  if (error == null) return null
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : 'erro desconhecido'
  return text.slice(0, 200)
}

export async function notifyOpsAlert(input: {
  tenantId?: string | null
  conversationId?: string | null
  type: OpsAlertType
  error?: unknown
}): Promise<void> {
  try {
    console.error('[OpsAlert]', {
      tenantId: input.tenantId ?? null,
      conversationId: input.conversationId ?? null,
      type: input.type,
      error: errorText(input.error),
    })

    if (!input.tenantId) return
    if (!(await acquireWindow(input.tenantId, input.type))) return

    const copy = ALERT_COPY[input.type]
    await broadcastPushNotificationToTenant(input.tenantId, {
      title: copy.title,
      body: copy.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `ops-${input.type}`,
      data: {
        url: input.conversationId ? `/atendimento?conversation=${input.conversationId}` : '/atendimento',
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      },
    })
  } catch (e) {
    console.error('[OpsAlert] falha ao alertar (ignorada):', e instanceof Error ? e.message : 'erro')
  }
}

/**
 * Quando a IA não pode responder: põe a conversa em modo humano com nota interna,
 * para ela aparecer como pendente no atendimento. Nunca lança.
 */
export async function moveConversationToHumanForOps(
  tenantId: string,
  conversationId: string,
  reason: string
): Promise<void> {
  try {
    await inboxDb.updateConversation(tenantId, conversationId, { mode: 'human' })
    await inboxDb.createMessage({
      tenant_id: tenantId,
      conversation_id: conversationId,
      direction: 'outbound',
      content: `🤖 **Transferência automática**\n\n**Motivo:** ${reason}`,
      message_type: 'internal_note',
      delivery_status: 'delivered',
      payload: { type: 'ai_handoff', reason, timestamp: new Date().toISOString() },
    })
  } catch (e) {
    console.error('[OpsAlert] falha ao passar conversa para humano (ignorada):', {
      tenantId,
      conversationId,
      error: errorText(e),
    })
  }
}
