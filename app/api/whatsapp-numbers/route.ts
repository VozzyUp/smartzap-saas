import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import {
  listWhatsAppNumbers,
  addWhatsAppNumber,
  mirrorActiveToSettings,
  resolveTenantByPhoneNumberId,
  refreshWhatsAppNumberDisplayPhoneNumber,
} from '@/lib/whatsapp-phone-numbers'
import { canAddWhatsAppNumber, planLimitResponse } from '@/lib/plan-limits'
import { fetchWithTimeout, safeJson, isAbortError } from '@/lib/server-http'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - Lista os números WhatsApp do tenant (nunca inclui access_token).
export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const numbers = await listWhatsAppNumbers(ctx.tenantId)
  const enrichedNumbers = await Promise.all(numbers.map(async (number) => {
    if (number.display_phone_number) return number
    const displayPhoneNumber = await refreshWhatsAppNumberDisplayPhoneNumber(ctx.tenantId, number.phone_number_id)
    return displayPhoneNumber ? { ...number, display_phone_number: displayPhoneNumber } : number
  }))
  return NextResponse.json({ numbers: enrichedNumbers })
}

// POST - Valida credenciais na Meta, aplica o gate de plano (reconexão-safe,
// mesmo padrão de app/api/settings/credentials/route.ts) e adiciona o número.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const { phoneNumberId, businessAccountId, accessToken, displayLabel } = body ?? {}
    if (!phoneNumberId || !businessAccountId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields: phoneNumberId, businessAccountId, accessToken' },
        { status: 400 }
      )
    }

    const testResponse = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 8000 }
    )
    if (!testResponse.ok) {
      const error = await safeJson<any>(testResponse)
      return NextResponse.json(
        { error: 'Invalid credentials - Meta API rejected the token', details: error?.error?.message || 'Unknown error' },
        { status: 401 }
      )
    }
    const phoneData = await safeJson<any>(testResponse)

    // Gate de plano: só bloqueia número genuinamente novo (reconexão-safe),
    // mesmo padrão adotado em app/api/settings/credentials/route.ts (T4).
    if (!ctx.isPlatformAdmin) {
      const existingTenant = await resolveTenantByPhoneNumberId(phoneNumberId)
      const isNewNumber = existingTenant !== ctx.tenantId
      if (isNewNumber) {
        const gate = await canAddWhatsAppNumber(ctx.tenantId)
        if (!gate.allowed) return planLimitResponse('whatsapp_numbers', gate)
      }
    }

    await addWhatsAppNumber(ctx.tenantId, {
      phoneNumberId,
      businessAccountId,
      accessToken,
      displayLabel,
      displayPhoneNumber: phoneData?.display_phone_number,
    })
    await mirrorActiveToSettings(ctx.tenantId)

    return NextResponse.json({
      success: true,
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber: phoneData?.display_phone_number,
      verifiedName: phoneData?.verified_name,
    })
  } catch (error) {
    console.error('Error adding WhatsApp number:', error)
    return NextResponse.json(
      { error: 'Failed to add WhatsApp number' },
      { status: isAbortError(error) ? 504 : 502 }
    )
  }
}
