/**
 * Push Notifications Service
 *
 * Gerencia envio de notificações push via Web Push API.
 * Requer VAPID keys configuradas em env vars.
 *
 * VAPID = Voluntary Application Server Identification
 * Permite identificar o servidor que envia as notificações
 */

import webpush from 'web-push'
import { createClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase'

// =============================================================================
// Configuration
// =============================================================================

interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:contato@smartzap.com'

  if (!publicKey || !privateKey) {
    console.warn('[Push] VAPID keys não configuradas')
    return null
  }

  return { publicKey, privateKey, subject }
}

function setupWebPush(): boolean {
  const config = getVapidConfig()
  if (!config) return false

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  return true
}

// =============================================================================
// Types
// =============================================================================

export interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  data?: Record<string, unknown>
  actions?: Array<{ action: string; title: string }>
}

export interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

// =============================================================================
// Push Functions
// =============================================================================

/**
 * Envia notificação para uma subscription específica
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: PushPayload
): Promise<{ success: boolean; error?: string }> {
  if (!setupWebPush()) {
    return { success: false, error: 'VAPID não configurado' }
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload)
    )

    return { success: true }
  } catch (error) {
    const err = error as Error & { statusCode?: number }

    // Se subscription expirou ou foi invalidada, remover do banco
    if (err.statusCode === 410 || err.statusCode === 404) {
      await removeInvalidSubscription(subscription.endpoint)
      return { success: false, error: 'Subscription expirada' }
    }

    console.error('[Push] Erro ao enviar:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Envia notificação para todas as subscriptions ativas
 */
export async function broadcastPushNotification(
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!setupWebPush()) {
    return { sent: 0, failed: 0 }
  }

  const supabase = await createClient()
  const { data: subscriptions } = await supabase.from('push_subscriptions').select('endpoint, keys')

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      sendPushNotification(sub as PushSubscriptionData, payload)
    )
  )

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.success) {
      sent++
    } else {
      failed++
    }
  })

  return { sent, failed }
}

/**
 * Envia notificação de nova mensagem
 */
export async function sendNewMessageNotification(
  contactName: string,
  preview: string,
  conversationId: string
): Promise<{ sent: number; failed: number }> {
  return broadcastPushNotification({
    title: contactName,
    body: preview.slice(0, 100),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `conversation-${conversationId}`,
    data: {
      url: `/atendimento?conversation=${conversationId}`,
      conversationId,
    },
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Dispensar' },
    ],
  })
}

/**
 * Envia notificação para as subscriptions de UM tenant.
 *
 * Usa o client admin (sem sessão) — para workers como /api/ai/respond — e filtra
 * por tenant_id. Nunca lança (best-effort).
 */
export async function broadcastPushNotificationToTenant(
  tenantId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  try {
    if (!setupWebPush()) return { sent: 0, failed: 0 }

    const admin = getSupabaseAdmin()
    if (!admin) return { sent: 0, failed: 0 }

    const { data: subscriptions, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('[Push] Erro ao ler subscriptions do tenant:', { tenantId, error })
      return { sent: 0, failed: 0 }
    }
    if (!subscriptions || subscriptions.length === 0) return { sent: 0, failed: 0 }

    const results = await Promise.allSettled(
      subscriptions.map((sub) => sendPushNotification(sub as PushSubscriptionData, payload))
    )
    const sent = results.filter((r) => r.status === 'fulfilled' && r.value.success).length
    return { sent, failed: results.length - sent }
  } catch (error) {
    console.error('[Push] Falha ao enviar para o tenant (best-effort):', { tenantId, error })
    return { sent: 0, failed: 0 }
  }
}

/**
 * Avisa o dono/atendentes do tenant que uma conversa foi transferida para humano.
 */
export async function sendHandoffNotification(
  tenantId: string,
  input: { conversationId: string; contactLabel: string; reason?: string | null }
): Promise<{ sent: number; failed: number }> {
  const reason = input.reason ? ` — ${input.reason}` : ''
  return broadcastPushNotificationToTenant(tenantId, {
    title: 'Conversa transferida para atendente',
    body: `${input.contactLabel} precisa de atendimento humano${reason}`.slice(0, 120),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `handoff-${input.conversationId}`,
    data: {
      url: `/atendimento?conversation=${input.conversationId}`,
      conversationId: input.conversationId,
    },
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Dispensar' },
    ],
  })
}

/**
 * Remove subscription inválida do banco
 */
async function removeInvalidSubscription(endpoint: string): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    console.log('[Push] Subscription inválida removida:', endpoint.slice(0, 50))
  } catch (error) {
    console.error('[Push] Erro ao remover subscription inválida:', error)
  }
}

// =============================================================================
// VAPID Key Generation (use once to generate keys)
// =============================================================================

/**
 * Gera par de chaves VAPID.
 * Execute uma vez e salve as chaves em variáveis de ambiente.
 *
 * @example
 * const keys = generateVapidKeys()
 * // Adicione ao .env:
 * // NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
 * // VAPID_PRIVATE_KEY=...
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys()
}
