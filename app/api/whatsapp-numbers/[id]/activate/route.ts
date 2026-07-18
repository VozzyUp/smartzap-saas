import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { setActiveWhatsAppNumber, mirrorActiveToSettings } from '@/lib/whatsapp-phone-numbers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST - Define o número [id] (phone_number_id) como ativo para o tenant.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    // setActiveWhatsAppNumber tem guard de posse: lança se o número não
    // existir ou não pertencer a este tenant. Tratamos como 404 (não 500),
    // pois do ponto de vista do tenant o recurso simplesmente não existe.
    await setActiveWhatsAppNumber(ctx.tenantId, id)
  } catch (error) {
    console.error('Error activating WhatsApp number:', error)
    return NextResponse.json({ error: 'WhatsApp number not found' }, { status: 404 })
  }
  await mirrorActiveToSettings(ctx.tenantId)
  return NextResponse.json({ success: true })
}
