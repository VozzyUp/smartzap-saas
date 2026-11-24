import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrApiKey } from '@/lib/request-auth'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { getMetaAppId } from '@/lib/meta-app-credentials'
import { getTenantContext } from '@/lib/tenant-context'
import {
  TemplateHeaderUploadError,
  uploadTemplateHeaderSample,
  validateTemplateHeaderFile,
} from '@/lib/whatsapp/template-header-upload'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// Node.js runtime - necessário para multipart/form-data com arquivos grandes
export const runtime = 'nodejs'
// O limite de corpo (20 MB) vem de next.config.ts (proxyClientMaxBodySize / serverActions.bodySizeLimit).
export const maxDuration = 60

function jsonNoStore(body: any, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

/**
 * POST /api/meta/uploads/template-header
 *
 * Recebe um arquivo via multipart/form-data e retorna { handle } para ser usado
 * como `header_handle` em templates com HEADER de mídia (IMAGE, VIDEO, GIF, DOCUMENT).
 *
 * Campos esperados:
 * - file: File (o arquivo de mídia)
 * - format: string ('IMAGE' | 'VIDEO' | 'GIF' | 'DOCUMENT')
 *
 * A validação de tipo/tamanho e o protocolo do Resumable Upload ficam em
 * lib/whatsapp/template-header-upload.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionOrApiKey(request)
    if (auth) return auth

    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return jsonNoStore({ error: 'unauthorized' }, { status: 401 })
    const tenantId = ctx.tenantId

    const metaAppId = await getMetaAppId(tenantId)
    if (!metaAppId) {
      return jsonNoStore(
        { error: 'ID do Aplicativo da Meta não configurado. Informe o ID do Aplicativo em Configurações → API para enviar mídia de exemplo.' },
        { status: 400 }
      )
    }

    const wa = await getWhatsAppCredentials(tenantId)
    if (!wa?.accessToken) {
      return jsonNoStore(
        { error: 'Credenciais do WhatsApp não configuradas. Configure o token de acesso em Configurações para enviar mídia.' },
        { status: 400 }
      )
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch (formErr) {
      const formErrMsg = formErr instanceof Error ? formErr.message : String(formErr)
      console.error('[template-header] FormData parse error:', formErrMsg)
      if (/body exceeded|too large|limit|PAYLOAD/i.test(formErrMsg)) {
        return jsonNoStore({ error: 'Arquivo muito grande para o servidor. Comprima o arquivo antes de enviar.' }, { status: 413 })
      }
      return jsonNoStore({ error: 'Falha ao ler o arquivo enviado.' }, { status: 400 })
    }

    const format = String(form.get('format') || '').trim().toUpperCase()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return jsonNoStore({ error: 'Arquivo ausente. Envie multipart com campo "file".' }, { status: 400 })
    }

    const validation = validateTemplateHeaderFile({
      format,
      fileName: file.name,
      size: file.size,
      mimeType: file.type,
    })
    if (!validation.ok) return jsonNoStore({ error: validation.error }, { status: 400 })

    const bytes = new Uint8Array(await file.arrayBuffer())
    const { handle } = await uploadTemplateHeaderSample({
      appId: metaAppId,
      accessToken: wa.accessToken,
      fileName: file.name || `template_header_${Date.now()}`,
      mimeType: validation.mimeType,
      bytes,
    })

    return jsonNoStore({ handle, format, mimeType: validation.mimeType, size: file.size })
  } catch (err) {
    if (err instanceof TemplateHeaderUploadError) {
      return jsonNoStore({ error: err.userMessage }, { status: err.status })
    }
    console.error('[template-header] erro inesperado:', err instanceof Error ? err.name : 'unknown')
    return jsonNoStore({ error: 'Erro inesperado ao enviar a mídia. Tente novamente.' }, { status: 500 })
  }
}
