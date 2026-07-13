import { NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

const KEYS = {
  onboardingCompleted: 'onboarding_completed',
  permanentTokenConfirmed: 'permanent_token_confirmed',
}

/**
 * GET /api/settings/onboarding
 * Retorna o status do onboarding (completo + token permanente) do tenant atual.
 * SEMPRE busca direto do banco (settingsDb já é per-tenant) - sem cache.
 */
export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const [onboardingCompleted, permanentTokenConfirmed] = await Promise.all([
      settingsDb.get(ctx.tenantId, KEYS.onboardingCompleted),
      settingsDb.get(ctx.tenantId, KEYS.permanentTokenConfirmed),
    ])

    const response = NextResponse.json({
      onboardingCompleted: onboardingCompleted === 'true',
      permanentTokenConfirmed: permanentTokenConfirmed === 'true',
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error) {
    console.error('Erro ao buscar settings de onboarding:', error)
    const response = NextResponse.json(
      { error: 'Erro ao buscar configurações' },
      { status: 500 }
    )
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  }
}

/**
 * POST /api/settings/onboarding
 * Salva configurações do onboarding do tenant atual.
 * Body: { onboardingCompleted?: boolean, permanentTokenConfirmed?: boolean }
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json()
    const { onboardingCompleted, permanentTokenConfirmed } = body

    const updates: Promise<void>[] = []

    if (typeof onboardingCompleted === 'boolean') {
      updates.push(settingsDb.set(ctx.tenantId, KEYS.onboardingCompleted, onboardingCompleted ? 'true' : 'false'))
    }

    if (typeof permanentTokenConfirmed === 'boolean') {
      updates.push(settingsDb.set(ctx.tenantId, KEYS.permanentTokenConfirmed, permanentTokenConfirmed ? 'true' : 'false'))
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum campo válido fornecido' },
        { status: 400 }
      )
    }

    await Promise.all(updates)

    return NextResponse.json({
      success: true,
      onboardingCompleted: typeof onboardingCompleted === 'boolean' ? onboardingCompleted : undefined,
      permanentTokenConfirmed: typeof permanentTokenConfirmed === 'boolean' ? permanentTokenConfirmed : undefined,
    })
  } catch (error) {
    console.error('Erro ao salvar settings de onboarding:', error)
    return NextResponse.json(
      { error: 'Erro ao salvar configurações' },
      { status: 500 }
    )
  }
}
