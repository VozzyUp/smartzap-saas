import { NextResponse } from 'next/server'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { normalizeSubscribedFields, type MetaSubscribedApp } from '@/lib/meta-webhook-subscription'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'
import { getVerifyToken } from '@/lib/verify-token'
import { getAppUrl } from '@/lib/app-url'
import { getTenantContext } from '@/lib/tenant-context'

const META_API_VERSION = 'v24.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/**
 * Computa a URL do webhook do V-Smart baseado no ambiente
 */
function computeWebhookUrl(): string {
  return `${getAppUrl()}/api/webhook`
}

/**
 * Consulta status de subscription do WABA (subscribed_apps)
 * Inclui override_callback_uri se disponível
 */
async function getMetaSubscriptionStatus(params: { wabaId: string; accessToken: string }) {
  const { wabaId, accessToken } = params

  // Consulta subscribed_apps com campos extras
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps?fields=id,name,subscribed_fields,override_callback_uri`
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    timeoutMs: 12000,
  })

  if (!response.ok) {
    const errorData = await safeJson<any>(response)
    return {
      ok: false as const,
      status: response.status,
      error: errorData?.error?.message || 'Erro ao consultar subscribed_apps',
      details: errorData?.error || errorData,
    }
  }

  const data = (await safeJson<{ data?: MetaSubscribedApp[] }>(response)) || {}
  const apps = data?.data || []
  const subscribedFields = normalizeSubscribedFields(apps)

  // Extrair override_callback_uri do primeiro app (nosso app)
  const ourApp = apps[0] as any
  const overrideCallbackUri = ourApp?.override_callback_uri || null

  return {
    ok: true as const,
    status: 200,
    apps,
    subscribedFields,
    messagesSubscribed: subscribedFields.includes('messages'),
    overrideCallbackUri,
  }
}

/**
 * Consulta a hierarquia de webhooks via phone_number para confirmar o override WABA
 */
async function getWebhookHierarchy(params: { phoneNumberId: string; accessToken: string }) {
  const { phoneNumberId, accessToken } = params

  const url = `${META_API_BASE}/${phoneNumberId}?fields=webhook_configuration`
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    timeoutMs: 12000,
  })

  if (!response.ok) {
    return { ok: false as const }
  }

  const data = await safeJson<any>(response)
  const webhookConfig = data?.webhook_configuration || {}

  return {
    ok: true as const,
    phoneNumberOverride: webhookConfig.phone_number || null,
    wabaOverride: webhookConfig.whatsapp_business_account || null,
    appWebhook: webhookConfig.application || null,
  }
}

/**
 * GET /api/meta/webhooks/subscription
 * Consulta status de subscription do WABA (subscribed_apps) + hierarquia de webhooks
 */
export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const credentials = await getWhatsAppCredentials(ctx.tenantId)

  if (!credentials?.businessAccountId || !credentials?.accessToken) {
    return NextResponse.json(
      { error: 'Credenciais não configuradas. Configure em Ajustes.' },
      { status: 401 }
    )
  }

  const result = await getMetaSubscriptionStatus({
    wabaId: credentials.businessAccountId,
    accessToken: credentials.accessToken,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        details: result.details,
      },
      { status: result.status }
    )
  }

  // Também consulta a hierarquia via phone_number para ter visão completa
  let hierarchy = null
  if (credentials.phoneNumberId) {
    const h = await getWebhookHierarchy({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
    })
    if (h.ok) {
      hierarchy = {
        phoneNumberOverride: h.phoneNumberOverride,
        wabaOverride: h.wabaOverride,
        appWebhook: h.appWebhook,
      }
    }
  }

  const smartzapWebhookUrl = computeWebhookUrl()
  const isWabaOverrideSmartZap = hierarchy?.wabaOverride
    ? hierarchy.wabaOverride.includes('/api/webhook')
    : false

  return NextResponse.json({
    ok: true,
    wabaId: credentials.businessAccountId,
    messagesSubscribed: result.messagesSubscribed,
    subscribedFields: result.subscribedFields,
    apps: result.apps,
    // Novo: informações do override WABA
    wabaOverride: {
      url: hierarchy?.wabaOverride || result.overrideCallbackUri || null,
      isConfigured: Boolean(hierarchy?.wabaOverride || result.overrideCallbackUri),
      isSmartZap: isWabaOverrideSmartZap,
    },
    hierarchy,
    smartzapWebhookUrl,
  })
}

/**
 * POST /api/meta/webhooks/subscription
 * Configura o webhook WABA (#2) com override_callback_uri
 *
 * Body:
 * { callbackUrl?: string } - Se não fornecido, usa a URL do V-Smart
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const credentials = await getWhatsAppCredentials(ctx.tenantId)

  if (!credentials?.businessAccountId || !credentials?.accessToken) {
    return NextResponse.json(
      { error: 'Credenciais não configuradas. Configure em Ajustes.' },
      { status: 401 }
    )
  }

  // Parse body
  let callbackUrl: string | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as { callbackUrl?: string }
    callbackUrl = body.callbackUrl
  } catch {
    // ignore
  }

  // Se não forneceu callbackUrl, usa a URL do V-Smart
  if (!callbackUrl) {
    callbackUrl = computeWebhookUrl()
  }

  // Validação: localhost não funciona com a Meta (ela precisa acessar a URL publicamente)
  if (callbackUrl.includes('localhost') || callbackUrl.includes('127.0.0.1')) {
    return NextResponse.json(
      {
        ok: false,
        error: 'URL localhost não é acessível pela Meta. Use uma URL pública (ex: Cloudflare Tunnel) ou teste em produção.',
        details: { attemptedUrl: callbackUrl },
      },
      { status: 400 }
    )
  }

  // Obter verify token
  const verifyToken = await getVerifyToken()

  // Configura o override no WABA via subscribed_apps
  const form = new URLSearchParams()
  form.set('subscribed_fields', 'messages')
  form.set('override_callback_uri', callbackUrl)
  form.set('verify_token', verifyToken)

  const response = await fetchWithTimeout(`${META_API_BASE}/${credentials.businessAccountId}/subscribed_apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
    timeoutMs: 12000,
  })

  if (!response.ok) {
    const errorData = await safeJson<any>(response)
    const errorCode = errorData?.error?.code
    const errorMessage = errorData?.error?.message || 'Erro ao configurar webhook WABA'

    // Erro 2200 = Callback verification failed (Meta não conseguiu acessar a URL)
    if (errorCode === 2200 || errorMessage.includes('Callback verification failed')) {
      return NextResponse.json(
        {
          ok: false,
          error: 'A Meta não conseguiu verificar a URL do webhook. Verifique se a URL é acessível publicamente e se o verify_token está correto.',
          details: {
            metaError: errorMessage,
            attemptedUrl: callbackUrl,
            hint: 'A Meta faz uma requisição GET para validar a URL. Se estiver em desenvolvimento, use Cloudflare Tunnel ou similar.',
          },
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        details: errorData?.error || errorData,
      },
      { status: response.status }
    )
  }

  // Retorna status atualizado
  const status = await getMetaSubscriptionStatus({
    wabaId: credentials.businessAccountId,
    accessToken: credentials.accessToken,
  })

  // Também consulta hierarquia para confirmar
  let hierarchy = null
  if (credentials.phoneNumberId) {
    const h = await getWebhookHierarchy({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
    })
    if (h.ok) {
      hierarchy = {
        phoneNumberOverride: h.phoneNumberOverride,
        wabaOverride: h.wabaOverride,
        appWebhook: h.appWebhook,
      }
    }
  }

  return NextResponse.json({
    ok: true,
    wabaId: credentials.businessAccountId,
    configuredUrl: callbackUrl,
    wabaOverride: {
      url: hierarchy?.wabaOverride || status.overrideCallbackUri || callbackUrl,
      isConfigured: true,
      isSmartZap: callbackUrl.includes('/api/webhook'),
    },
    hierarchy,
    status: status.ok
      ? {
          messagesSubscribed: status.messagesSubscribed,
          subscribedFields: status.subscribedFields,
        }
      : null,
  })
}

/**
 * DELETE /api/meta/webhooks/subscription
 * Remove o override WABA (volta a usar App #3)
 *
 * Nota: Isso faz POST com override_callback_uri vazio para remover o override,
 * mas mantém a inscrição nos campos (messages).
 */
export async function DELETE() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const credentials = await getWhatsAppCredentials(ctx.tenantId)

  if (!credentials?.businessAccountId || !credentials?.accessToken) {
    return NextResponse.json(
      { error: 'Credenciais não configuradas. Configure em Ajustes.' },
      { status: 401 }
    )
  }

  // Para remover o override, enviamos POST com override_callback_uri vazio
  // Mantemos subscribed_fields para não perder a inscrição
  const form = new URLSearchParams()
  form.set('subscribed_fields', 'messages')
  form.set('override_callback_uri', '') // Vazio remove o override

  const response = await fetchWithTimeout(`${META_API_BASE}/${credentials.businessAccountId}/subscribed_apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
    timeoutMs: 12000,
  })

  if (!response.ok) {
    const errorData = await safeJson<any>(response)
    return NextResponse.json(
      {
        ok: false,
        error: errorData?.error?.message || 'Erro ao remover override WABA',
        details: errorData?.error || errorData,
      },
      { status: response.status }
    )
  }

  // Retorna status atualizado
  const status = await getMetaSubscriptionStatus({
    wabaId: credentials.businessAccountId,
    accessToken: credentials.accessToken,
  })

  // Também consulta hierarquia para confirmar remoção
  let hierarchy = null
  if (credentials.phoneNumberId) {
    const h = await getWebhookHierarchy({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
    })
    if (h.ok) {
      hierarchy = {
        phoneNumberOverride: h.phoneNumberOverride,
        wabaOverride: h.wabaOverride,
        appWebhook: h.appWebhook,
      }
    }
  }

  return NextResponse.json({
    ok: true,
    wabaId: credentials.businessAccountId,
    wabaOverride: {
      url: null,
      isConfigured: false,
      isSmartZap: false,
    },
    hierarchy,
    status: status.ok
      ? {
          messagesSubscribed: status.messagesSubscribed,
          subscribedFields: status.subscribedFields,
        }
      : null,
  })
}
