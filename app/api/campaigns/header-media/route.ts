/**
 * POST /api/campaigns/header-media  (multipart: file, format)
 *
 * "Enviar com este arquivo" no assistente de nova campanha: sobe a mídia do cabeçalho para o
 * número do tenant (`/{phone-number-id}/media`) e devolve o media id, que a tela envia como
 * `templateVariables.headerMediaId` ao criar a campanha. Escopado por tenant (credenciais do
 * número ativo da conta). Media ids da Meta valem 30 dias.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { uploadMediaToMeta } from '@/lib/whatsapp/media'
import { validateTemplateHeaderFile } from '@/lib/whatsapp/template-header-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (esperado multipart/form-data).' }, { status: 400 })
  }

  const file = form.get('file')
  const format = String(form.get('format') || '').toUpperCase()
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Envie o arquivo no campo "file".' }, { status: 400 })
  }
  if (!format) {
    return NextResponse.json({ error: 'Informe o formato do cabeçalho (IMAGE, VIDEO...).' }, { status: 400 })
  }

  const fileName = (file as File).name || 'midia'
  const validation = validateTemplateHeaderFile({
    format,
    fileName,
    size: file.size,
    mimeType: file.type,
  })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 })
  }

  const credentials = await getWhatsAppCredentials(ctx.tenantId)
  if (!credentials?.phoneNumberId || !credentials?.accessToken) {
    return NextResponse.json(
      { error: 'WhatsApp não configurado. Conecte um número antes de enviar mídia.' },
      { status: 409 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const uploaded = await uploadMediaToMeta({
    phoneNumberId: credentials.phoneNumberId,
    accessToken: credentials.accessToken,
    buffer,
    contentType: validation.mimeType,
    filename: fileName,
  })

  if (!uploaded.ok) {
    return NextResponse.json(
      { error: `Falha ao enviar a mídia para a Meta: ${uploaded.error || 'erro desconhecido'}` },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true, mediaId: uploaded.id, fileName, mimeType: validation.mimeType })
}
