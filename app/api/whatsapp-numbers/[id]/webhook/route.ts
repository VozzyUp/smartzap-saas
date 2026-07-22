import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getWhatsAppCredentialsForNumber } from '@/lib/whatsapp-credentials'
import { subscribeWabaToWebhook, getWabaWebhookStatus } from '@/lib/meta-webhook-subscription'
import { getVerifyToken } from '@/lib/verify-token'
import { getAppUrl } from '@/lib/app-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteParams {
  params: Promise<{ id: string }>
}

function webhookCallbackUrl(): string {
  return `${getAppUrl()}/api/webhook`
}

// GET - status da assinatura do webhook do WABA deste número
export async function GET(request: NextRequest, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: phoneNumberId } = await params
  const creds = await getWhatsAppCredentialsForNumber(ctx.tenantId, phoneNumberId)
  if (!creds?.businessAccountId || !creds?.accessToken) {
    return NextResponse.json({ error: 'Número sem credenciais salvas' }, { status: 400 })
  }

  const status = await getWabaWebhookStatus({ wabaId: creds.businessAccountId, accessToken: creds.accessToken })
  const expectedWebhookUrl = webhookCallbackUrl()

  // A Meta às vezes não lista "messages" em subscribed_fields mesmo com o
  // webhook funcionando de verdade — o sinal confiável é messages OU o
  // override_callback_uri já apontando pro V-Smart (mesma lógica usada em
  // app/api/meta/diagnostics/route.ts, validada em produção).
  const webhookActive = status.messagesSubscribed || status.overrideCallbackUri === expectedWebhookUrl

  return NextResponse.json({
    messagesSubscribed: status.messagesSubscribed,
    overrideCallbackUri: status.overrideCallbackUri,
    expectedWebhookUrl,
    webhookActive,
    ok: status.ok,
    error: status.error,
  })
}

// POST - assina o webhook do WABA deste número (o passo que faz a Meta
// começar a entregar as mensagens recebidas no inbox do V-Smart)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: phoneNumberId } = await params
  const creds = await getWhatsAppCredentialsForNumber(ctx.tenantId, phoneNumberId)
  if (!creds?.businessAccountId || !creds?.accessToken) {
    return NextResponse.json({ error: 'Número sem credenciais salvas' }, { status: 400 })
  }

  const verifyToken = await getVerifyToken()
  const result = await subscribeWabaToWebhook({
    wabaId: creds.businessAccountId,
    accessToken: creds.accessToken,
    callbackUrl: webhookCallbackUrl(),
    verifyToken,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Falha ao ativar o webhook' }, { status: 502 })
  }
  return NextResponse.json({ success: true })
}
