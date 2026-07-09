import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { isSupabaseConfigured } from '@/lib/supabase'
import { fetchWithTimeout, safeJson, isAbortError } from '@/lib/server-http'
import { getTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Credenciais armazenadas apenas no Supabase settings table
// Configuradas via UI no onboarding pós-instalação

// GET - Fetch credentials from DB only
export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        isConnected: false,
        warning: 'Supabase não configurado.',
      })
    }

    // Buscar do banco de dados
    let dbSettings = {
      phoneNumberId: '',
      businessAccountId: '',
      accessToken: '',
      isConnected: false,
    }

    try {
      dbSettings = await settingsDb.getAll(ctx.tenantId)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('Error fetching settings from DB:', errorMsg)
      return NextResponse.json({
        isConnected: false,
        warning: `Falha ao ler credenciais do DB: ${errorMsg}`,
      })
    }

    const { phoneNumberId, businessAccountId, accessToken, isConnected } = dbSettings

    // Se não tem credenciais ou está desconectado
    if (!phoneNumberId || !businessAccountId || !accessToken || !isConnected) {
      return NextResponse.json({
        isConnected: false,
      })
    }

    // Buscar informações adicionais da Meta API
    let displayPhoneNumber: string | undefined
    let verifiedName: string | undefined

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2500)
      const metaResponse = await fetch(
        `https://graph.facebook.com/v24.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { 'Authorization': `Bearer ${accessToken}` }, signal: controller.signal }
      )
      clearTimeout(timeout)
      if (metaResponse.ok) {
        const metaData = await metaResponse.json()
        displayPhoneNumber = metaData.display_phone_number
        verifiedName = metaData.verified_name
      }
    } catch {
      // Ignore errors, just won't have display number
    }

    return NextResponse.json({
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber,
      verifiedName,
      hasToken: true,
      tokenPreview: '••••••••••',
      isConnected: true,
    })
  } catch (error) {
    console.error('Error fetching credentials:', error)
    return NextResponse.json({
      isConnected: false,
      error: 'Failed to fetch credentials',
      details: String((error as Error)?.message || error),
    })
  }
}

// POST - Validate AND Save credentials to DB
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
    }
    const { phoneNumberId, businessAccountId, accessToken } = body

    if (!phoneNumberId || !businessAccountId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields: phoneNumberId, businessAccountId, accessToken' },
        { status: 400 }
      )
    }

    // Validate token by making a test call to Meta API
    const testResponse = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        timeoutMs: 8000,
      }
    )

    if (!testResponse.ok) {
      const error = await safeJson<any>(testResponse)
      return NextResponse.json(
        {
          error: 'Invalid credentials - Meta API rejected the token',
          details: error?.error?.message || 'Unknown error'
        },
        { status: 401 }
      )
    }

    const phoneData = await safeJson<any>(testResponse)

    // Save to Database (Persist across refreshes)
    await settingsDb.saveAll(ctx.tenantId, {
      phoneNumberId,
      businessAccountId,
      accessToken,
      isConnected: true
    })

    return NextResponse.json({
      success: true,
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber: phoneData.display_phone_number,
      verifiedName: phoneData.verified_name,
      qualityRating: phoneData.quality_rating,
      message: 'Credentials verified and saved successfully.'
    })
  } catch (error) {
    console.error('Error validating credentials:', error)
    return NextResponse.json(
      { error: 'Failed to validate credentials' },
      { status: isAbortError(error) ? 504 : 502 }
    )
  }
}

// DELETE - Clear credentials from DB
export async function DELETE() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Remove credenciais principais
    await settingsDb.saveAll(ctx.tenantId, {
      phoneNumberId: '',
      businessAccountId: '',
      accessToken: '',
      isConnected: false
    })

    // Remove também o Meta App ID/Secret
    await Promise.all([
      settingsDb.set(ctx.tenantId, 'metaAppId', ''),
      settingsDb.set(ctx.tenantId, 'metaAppSecret', ''),
    ])

    return NextResponse.json({
      success: true,
      message: 'Credentials removed from database.'
    })
  } catch (error) {
    console.error('Error deleting credentials:', error)
    return NextResponse.json(
      { error: 'Failed to delete credentials' },
      { status: 500 }
    )
  }
}
