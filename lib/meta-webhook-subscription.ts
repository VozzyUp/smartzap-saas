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

/**
 * Assina o webhook do V-Smart no WABA (subscribed_apps) com o campo `messages`
 * e um override_callback_uri apontando pra nossa URL. Este é o passo que faz a
 * Meta começar a entregar as mensagens recebidas — sem ele, o número fica
 * cadastrado mas nunca recebe nada no inbox.
 */
export async function subscribeWabaToWebhook(params: {
  wabaId: string
  accessToken: string
  callbackUrl: string
  verifyToken: string
}): Promise<{ ok: boolean; error?: string }> {
  const { wabaId, accessToken, callbackUrl, verifyToken } = params

  const form = new URLSearchParams()
  form.set('subscribed_fields', 'messages')
  form.set('override_callback_uri', callbackUrl)
  form.set('verify_token', verifyToken)

  try {
    const response = await fetchWithTimeout(`${META_API_BASE}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
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
