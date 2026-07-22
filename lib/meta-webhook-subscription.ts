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
  body?: URLSearchParams
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const hasBody = params.body !== undefined && params.body.toString().length > 0
    const response = await fetchWithTimeout(`${META_API_BASE}/${params.wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        ...(hasBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(hasBody ? { body: params.body!.toString() } : {}),
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
 * IMPORTANTE: são DUAS chamadas separadas, não uma, e a 1ª precisa ser
 * TOTALMENTE VAZIA (sem subscribed_fields, sem nada). A Meta rejeita com erro
 * #100 ("Before override the current callback uri, your app must be
 * subscribed to receive messages") qualquer chamada que inclua
 * override_callback_uri se o app nunca foi inscrito antes no WABA — mesmo
 * que a chamada também inclua subscribed_fields (confirmado tanto na doc
 * oficial da Meta quanto em relatos de terceiros com o mesmo erro usando uma
 * chamada só com override_callback_uri, sem subscribed_fields nenhum).
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/
 */
export async function subscribeWabaToWebhook(params: {
  wabaId: string
  accessToken: string
  callbackUrl: string
  verifyToken: string
  // Campos a assinar. Números API oficial (sem app no celular) devem passar
  // 'messages' explicitamente — smb_message_echoes só existe pra coexistência
  // e, se pedido sem sentido pro número, é só uma chamada extra pra nada.
  // Default: tenta messages+smb_message_echoes (comportamento pré-existente).
  fields?: string
}): Promise<{ ok: boolean; error?: string }> {
  const { wabaId, accessToken, callbackUrl, verifyToken } = params
  const requestedFields = params.fields ?? 'messages,smb_message_echoes'

  // 1) Inscrição BARE — sem nenhum parâmetro. Só isso "registra" o app como
  // inscrito no WABA; é pré-requisito pra Meta aceitar a chamada seguinte.
  const subscribeResult = await postSubscribedApps({ wabaId, accessToken })
  if (!subscribeResult.ok) {
    return { ok: false, error: `Passo 1/2 (inscrição): ${subscribeResult.error}` }
  }

  // 2) Só depois, com o app já inscrito, campos + override_callback_uri juntos.
  // smb_message_echoes: campo separado que a Meta usa pra "ecoar" mensagens
  // enviadas pelo app do WhatsApp Business no celular (coexistência) — sem
  // essa inscrição, o V-Smart nunca recebe o que o atendente manda por lá.
  const overrideResult = await postOverride({ wabaId, accessToken, callbackUrl, verifyToken, fields: requestedFields })
  if (overrideResult.ok) return overrideResult

  // Fallback só faz sentido se smb_message_echoes foi tentado: é um campo
  // mais novo que pode não estar liberado pro App na Meta ainda, e nesse
  // caso a Meta rejeita a chamada INTEIRA (não só o campo problemático).
  // Se o chamador já pediu só "messages" (número API oficial), não há pra
  // onde recuar — retorna o erro direto.
  if (!requestedFields.includes('smb_message_echoes')) {
    return { ok: false, error: overrideResult.error }
  }

  const fallbackResult = await postOverride({ wabaId, accessToken, callbackUrl, verifyToken, fields: 'messages' })
  if (fallbackResult.ok) return fallbackResult

  return { ok: false, error: fallbackResult.error }
}

async function postOverride(params: {
  wabaId: string
  accessToken: string
  callbackUrl: string
  verifyToken: string
  fields: string
}): Promise<{ ok: boolean; error?: string }> {
  const body = new URLSearchParams()
  body.set('subscribed_fields', params.fields)
  body.set('override_callback_uri', params.callbackUrl)
  body.set('verify_token', params.verifyToken)

  const result = await postSubscribedApps({ wabaId: params.wabaId, accessToken: params.accessToken, body })
  if (!result.ok) {
    return { ok: false, error: `Passo 2/2 (override, campos: ${params.fields}): ${result.error}` }
  }
  return result
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
