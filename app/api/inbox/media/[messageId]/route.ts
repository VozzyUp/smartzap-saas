import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getSignedMediaUrl } from '@/lib/inbox/inbox-media'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - Redireciona para uma signed URL curta da mídia da mensagem, escopada
// por tenant. A mídia vive em bucket privado; o token da Meta nunca vai ao
// client. Usada pela UI como src de <img>/<audio>/<video> e download de doc.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { messageId } = await params
  const url = await getSignedMediaUrl(ctx.tenantId, messageId)
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.redirect(url, 302)
}
