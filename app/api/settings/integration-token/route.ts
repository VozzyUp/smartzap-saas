import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'
import {
  buildInboundToken,
  EVENT_STAGE_MAP_SETTING_KEY,
  INBOUND_TOKEN_SETTING_KEY,
} from '@/lib/integrations/lead-event'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET -> { configured, stageMap }. Nunca devolve o token (só o hash fica salvo). */
export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [hash, mapRaw] = await Promise.all([
    settingsDb.get(ctx.tenantId, INBOUND_TOKEN_SETTING_KEY).catch(() => null),
    settingsDb.get(ctx.tenantId, EVENT_STAGE_MAP_SETTING_KEY).catch(() => null),
  ])
  let stageMap: Record<string, string> = {}
  try {
    stageMap = mapRaw ? JSON.parse(mapRaw) : {}
  } catch {
    stageMap = {}
  }
  return NextResponse.json({ ok: true, configured: Boolean(hash), stageMap })
}

/**
 * POST -> gera um token novo (invalida o anterior) e o mostra UMA vez.
 * Corpo opcional { stageMap: { evento: "Fase" } } para salvar o mapeamento evento->fase.
 */
export async function POST(request: NextRequest) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const action = (body as any)?.action

  if (action === 'save_map') {
    const map = (body as any)?.stageMap
    const valid =
      map && typeof map === 'object' && !Array.isArray(map) &&
      Object.entries(map).every(([k, v]) => k.trim() && typeof v === 'string' && v.trim())
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'stageMap deve ser { evento: "Fase" }' }, { status: 422 })
    }
    await settingsDb.set(ctx.tenantId, EVENT_STAGE_MAP_SETTING_KEY, JSON.stringify(map))
    return NextResponse.json({ ok: true, stageMap: map })
  }

  const { token, hash } = buildInboundToken(ctx.tenantId)
  await settingsDb.set(ctx.tenantId, INBOUND_TOKEN_SETTING_KEY, hash)
  return NextResponse.json({ ok: true, token, notice: 'Guarde este token agora: ele não será mostrado de novo.' })
}
