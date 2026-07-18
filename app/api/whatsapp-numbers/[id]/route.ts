import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { removeWhatsAppNumber, mirrorActiveToSettings } from '@/lib/whatsapp-phone-numbers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// DELETE - Remove o número [id] (phone_number_id) do tenant. Se era o
// ativo, removeWhatsAppNumber já promove outro (se existir); espelhamos
// o resultado em settings para os call-sites legados.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    await removeWhatsAppNumber(ctx.tenantId, id)
  } catch (error) {
    console.error('Error removing WhatsApp number:', error)
    return NextResponse.json({ error: 'Failed to remove WhatsApp number' }, { status: 500 })
  }
  await mirrorActiveToSettings(ctx.tenantId)
  return NextResponse.json({ success: true })
}
