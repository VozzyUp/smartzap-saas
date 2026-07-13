import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

const SETTING_KEY = 'ai_agents_global_enabled'

/**
 * GET /api/settings/ai-agents-toggle
 * Retorna o estado do toggle de agentes IA do tenant atual
 * ("global" = todos os agentes do tenant, não da plataforma).
 */
export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const value = await settingsDb.get(ctx.tenantId, SETTING_KEY)

    // Default: habilitado se não existir
    const enabled = value !== 'false'

    return NextResponse.json({ enabled })
  } catch (error) {
    console.error('[AI Agents Toggle] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI agents toggle' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/settings/ai-agents-toggle
 * Atualiza o estado do toggle de agentes IA do tenant atual
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      )
    }

    await settingsDb.set(ctx.tenantId, SETTING_KEY, enabled.toString())

    return NextResponse.json({
      success: true,
      enabled,
      message: enabled
        ? 'Agentes IA habilitados'
        : 'Agentes IA desabilitados'
    })
  } catch (error) {
    console.error('[AI Agents Toggle] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to save AI agents toggle' },
      { status: 500 }
    )
  }
}
