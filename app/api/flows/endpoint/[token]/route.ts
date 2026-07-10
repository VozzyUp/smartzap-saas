/**
 * WhatsApp Flow Endpoint (por tenant)
 *
 * Endpoint para data_exchange em WhatsApp Flows. A URL carrega um token opaco
 * por tenant (flows_webhook_token) porque a chave privada necessária para
 * decifrar o payload é per-tenant — não há como resolver o tenant depois de
 * decriptar (payload não carrega phone_number_id nem nada identificável).
 *
 * POST /api/flows/endpoint/[token]
 */

import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { resolveTenantByFlowsWebhookToken } from '@/lib/whatsapp-phone-numbers'
import {
  decryptRequest,
  encryptResponse,
  createErrorResponse,
  generateKeyPair,
  type FlowDataExchangeRequest,
} from '@/lib/whatsapp/flow-endpoint-crypto'
import { handleFlowAction } from '@/lib/whatsapp/flow-endpoint-handlers'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { metaSetEncryptionPublicKey } from '@/lib/meta-flows-api'

const PRIVATE_KEY_SETTING = 'whatsapp_flow_private_key'
const PUBLIC_KEY_SETTING = 'whatsapp_flow_public_key'

interface Params {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { token } = await params
    const tenantId = await resolveTenantByFlowsWebhookToken(token)
    if (!tenantId) {
      return NextResponse.json({ error: 'Endpoint não encontrado' }, { status: 404 })
    }

    const body = await request.json()
    console.log('[flow-endpoint] 📥 POST received at', new Date().toISOString())

    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
      console.error('[flow-endpoint] ❌ Campos obrigatorios ausentes')
      return NextResponse.json({ error: 'Campos obrigatorios ausentes' }, { status: 400 })
    }

    let privateKey = await settingsDb.get(tenantId, PRIVATE_KEY_SETTING)

    if (!privateKey) {
      console.log('[flow-endpoint] 🔑 Chave privada não encontrada, gerando automaticamente...')
      const { publicKey, privateKey: newPrivateKey } = generateKeyPair()
      await Promise.all([
        settingsDb.set(tenantId, PRIVATE_KEY_SETTING, newPrivateKey),
        settingsDb.set(tenantId, PUBLIC_KEY_SETTING, publicKey),
      ])
      privateKey = newPrivateKey
      console.log('[flow-endpoint] ✅ Chaves RSA geradas e salvas automaticamente')

      try {
        const credentials = await getWhatsAppCredentials(tenantId)
        if (credentials?.accessToken && credentials?.phoneNumberId) {
          await metaSetEncryptionPublicKey({
            accessToken: credentials.accessToken,
            phoneNumberId: credentials.phoneNumberId,
            publicKey,
          })
          console.log('[flow-endpoint] ✅ Chave pública sincronizada com a Meta automaticamente')
        } else {
          console.log('[flow-endpoint] ⚠️ Credenciais WhatsApp não configuradas, sincronização pendente')
        }
      } catch (syncError) {
        console.error('[flow-endpoint] ⚠️ Falha ao sincronizar com Meta (não-bloqueante):', syncError)
      }
    }

    let decrypted
    try {
      decrypted = decryptRequest(
        { encrypted_flow_data, encrypted_aes_key, initial_vector },
        privateKey
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isOaepError = errorMessage.includes('oaep') || errorMessage.includes('OAEP')
      console.error(
        '[flow-endpoint] ❌ Erro ao descriptografar:',
        isOaepError
          ? 'OAEP key mismatch — chave pública registrada na Meta não corresponde à chave privada local. Verifique as chaves em /settings/flows'
          : errorMessage
      )
      return NextResponse.json({ error: 'Falha na descriptografia' }, { status: 421 })
    }

    const flowRequest = decrypted.decryptedBody as unknown as FlowDataExchangeRequest
    console.log('[flow-endpoint] 🔓 Decrypted - Action:', flowRequest.action, 'Screen:', flowRequest.screen)

    if (flowRequest.action === 'ping') {
      console.log('[flow-endpoint] 🏓 PING received at', new Date().toISOString())
      const pingResponse = { data: { status: 'active' } }
      const encryptedPingResponse = encryptResponse(pingResponse, decrypted.aesKeyBuffer, decrypted.initialVectorBuffer)
      return new NextResponse(encryptedPingResponse, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }

    let response
    try {
      response = await handleFlowAction(tenantId, flowRequest)
      console.log('[flow-endpoint] ✅ Handler response:', JSON.stringify(response).substring(0, 500))
    } catch (error) {
      console.error('[flow-endpoint] ❌ Erro no handler:', error)
      response = createErrorResponse(error instanceof Error ? error.message : 'Erro interno')
    }

    const encryptedResponse = encryptResponse(response, decrypted.aesKeyBuffer, decrypted.initialVectorBuffer)
    return new NextResponse(encryptedResponse, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  } catch (error) {
    console.error('[flow-endpoint] Erro geral:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

/**
 * GET - Health check simples (sem criptografia)
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params
  const tenantId = await resolveTenantByFlowsWebhookToken(token)
  if (!tenantId) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 })
  }
  const privateKey = await settingsDb.get(tenantId, PRIVATE_KEY_SETTING)
  const configured = !!privateKey
  return NextResponse.json({
    status: configured ? 'ready' : 'not_configured',
    message: configured ? 'Flow endpoint configurado e pronto' : 'Chave privada nao configurada. Configure em /settings/flows',
  })
}
