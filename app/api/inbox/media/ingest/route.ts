/**
 * Fase 5A — Task 5: worker QStash de download de mídia recebida
 *
 * Rota consumida assincronamente pelo QStash (enfileirada em
 * `lib/inbox/inbox-webhook.ts` a partir do webhook da Meta). Baixa a mídia
 * do WABA do tenant e persiste no bucket privado do inbox via
 * `storeInboundMedia` (T3).
 *
 * Verificação de assinatura: usa o wrapper oficial `verifySignatureAppRouter`
 * de `@upstash/qstash/nextjs`, que valida o header `Upstash-Signature` contra
 * `QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY` (já provisionadas no
 * `.env.example`) e retorna 401 automaticamente quando a assinatura é
 * inválida ou ausente — nenhuma outra rota do repo consumia jobs QStash
 * ainda (as existentes só publicam), então este é o primeiro uso do
 * verificador; é o helper oficial do próprio pacote já usado como dependência
 * (`@upstash/qstash`), por isso foi escolhido em vez de reimplementar a
 * verificação HMAC manualmente.
 *
 * Política de resposta: SEMPRE 200 quando a assinatura é válida e o corpo é
 * bem formado — mesmo se a credencial do tenant não existir ou se
 * `storeInboundMedia` falhar internamente. `storeInboundMedia` já marca a
 * mensagem como `media_status='failed'` e nunca relança; devolver 200 evita
 * que o QStash reagende o job indefinidamente para um erro que não se
 * resolve sozinho (sem credencial válida, o retry teria o mesmo resultado).
 * Erros inesperados (ex.: exceção não tratada) também retornam 200 pelo
 * mesmo motivo — best-effort, não há caminho de recuperação automática aqui.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { storeInboundMedia } from '@/lib/inbox/inbox-media'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'

interface IngestPayload {
  tenantId: string
  conversationId: string
  messageId: string
  mediaId: string
}

function parsePayload(body: unknown): IngestPayload | null {
  if (!body || typeof body !== 'object') return null
  const { tenantId, conversationId, messageId, mediaId } = body as Record<string, unknown>
  if (
    typeof tenantId !== 'string' || !tenantId ||
    typeof conversationId !== 'string' || !conversationId ||
    typeof messageId !== 'string' || !messageId ||
    typeof mediaId !== 'string' || !mediaId
  ) {
    return null
  }
  return { tenantId, conversationId, messageId, mediaId }
}

async function handler(request: NextRequest): Promise<Response> {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const payload = parsePayload(rawBody)
  if (!payload) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const { tenantId, conversationId, messageId, mediaId } = payload

  try {
    const credentials = await getWhatsAppCredentials(tenantId)
    if (!credentials) {
      console.error(
        `[InboxMediaIngest] Sem credenciais WhatsApp para tenant ${tenantId}; job ignorado (best-effort).`
      )
      return NextResponse.json({ success: true, skipped: true }, { status: 200 })
    }

    await storeInboundMedia({
      tenantId,
      conversationId,
      messageId,
      mediaId,
      accessToken: credentials.accessToken,
    })
  } catch (error) {
    // storeInboundMedia não relança, mas mantemos esta rede de segurança
    // para qualquer erro inesperado (ex.: resolução de credenciais).
    console.error('[InboxMediaIngest] Erro inesperado ao processar job:', error)
  }

  return NextResponse.json({ success: true }, { status: 200 })
}

export const POST = verifySignatureAppRouter(handler)
