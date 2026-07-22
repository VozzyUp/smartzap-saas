import { fetchWithTimeout, safeJson } from '@/lib/server-http'

export type MetaSubscribedApp = {
  id?: string
  name?: string
  subscribed_fields?: string[]
  override_callback_uri?: string
}

const META_API_VERSION = 'v24.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export function normalizeSubscribedFields(apps: MetaSubscribedApp[]): string[] {
  const fields = new Set<string>()
  for (const app of apps) {
    for (const f of app.subscribed_fields || []) fields.add(f)
  }
  return Array.from(fields)
}

export function isMessagesSubscribed(apps: MetaSubscribedApp[]): boolean {
  return normalizeSubscribedFields(apps).includes('messages')
}

async function postSubscribedApps(params: {
  wabaId: string
  accessToken: string
  body: URLSearchParams
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchWithTimeout(`${META_API_BASE}/${params.wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.body.toString(),
      cache: 'no-store',
      timeoutMs: 12000,
    })

    if (!response.ok) {
      const err = await safeJson<any>(response)
      return { ok: false, error: err?.error?.message || 'Falha ao assinar o webhook na Meta' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro de rede ao assinar o webhook' }
  }
}

/**
 * Assina o webhook do V-Smart no WABA (subscribed_apps): campos `messages` +
 * `smb_message_echoes`, e um override_callback_uri apontando pra nossa URL.
 * Este é o passo que faz a Meta começar a entregar as mensagens — sem ele, o
 * número fica cadastrado mas nunca recebe nada no inbox.
 *
 * IMPORTANTE: são DUAS chamadas separadas, não uma. A Meta rejeita com erro
 * #100 ("Before override the current callback uri, your app must be
 * subscribed to receive messages") se você tentar inscrever os campos E
 * setar o override_callback_uri na mesma chamada, quando o WABA nunca foi
 * inscrito antes (todo WABA novo entrando via coexistência cai nesse caso).
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/
 */
export async function subscribeWabaToWebhook(params: {
  wabaId: string
  accessToken: string
  callbackUrl: string
  verifyToken: string
}): Promise<{ ok: boolean; error?: string }> {
  const { wabaId, accessToken, callbackUrl, verifyToken } = params

  // 1) Inscreve os campos primeiro, SEM override_callback_uri.
  const subscribeBody = new URLSearchParams()
  // smb_message_echoes: campo separado que a Meta usa pra "ecoar" mensagens
  // enviadas pelo app do WhatsApp Business no celular (coexistência) — sem
  // essa inscrição, o V-Smart nunca recebe o que o atendente manda por lá.
  subscribeBody.set('subscribed_fields', 'messages,smb_message_echoes')

  const subscribeResult = await postSubscribedApps({ wabaId, accessToken, body: subscribeBody })
  if (!subscribeResult.ok) return subscribeResult

  // 2) Só depois, com o app já inscrito, seta o override_callback_uri.
  const overrideBody = new URLSearchParams()
  overrideBody.set('override_callback_uri', callbackUrl)
  overrideBody.set('verify_token', verifyToken)

  return postSubscribedApps({ wabaId, accessToken, body: overrideBody })
}

/**
 * Consulta o status da assinatura do webhook do WABA — se o campo `messages`
 * está inscrito e qual o override_callback_uri configurado.
 */
export async function getWabaWebhookStatus(params: {
  wabaId: string
  accessToken: string
}): Promise<{ ok: boolean; messagesSubscribed: boolean; overrideCallbackUri: string | null; error?: string }> {
  const { wabaId, accessToken } = params

  try {
    const response = await fetchWithTimeout(
      `${META_API_BASE}/${wabaId}/subscribed_apps?fields=id,name,subscribed_fields,override_callback_uri`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        timeoutMs: 12000,
      }
    )

    if (!response.ok) {
      const err = await safeJson<any>(response)
      return { ok: false, messagesSubscribed: false, overrideCallbackUri: null, error: err?.error?.message || 'Falha ao consultar o webhook na Meta' }
    }

    const data = await safeJson<any>(response)
    const apps: MetaSubscribedApp[] = data?.data ?? []
    const overrideCallbackUri = apps.find((a) => a.override_callback_uri)?.override_callback_uri ?? null

    return {
      ok: true,
      messagesSubscribed: isMessagesSubscribed(apps),
      overrideCallbackUri,
    }
  } catch (e) {
    return { ok: false, messagesSubscribed: false, overrideCallbackUri: null, error: e instanceof Error ? e.message : 'Erro de rede ao consultar o webhook' }
  }
}
