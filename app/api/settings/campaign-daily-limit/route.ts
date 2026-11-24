import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'
import { DAILY_LIMIT_SETTING_KEY, parseDailyLimit } from '@/lib/campaign-daily-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LIMIT = 1_000_000

/** GET /api/settings/campaign-daily-limit -> { ok, limit } (0 = sem limite) */
export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const raw = await settingsDb.get(ctx.tenantId, DAILY_LIMIT_SETTING_KEY).catch(() => null)
  return NextResponse.json({ ok: true, limit: parseDailyLimit(raw) })
}

/** POST /api/settings/campaign-daily-limit { limit } -> inteiro >= 0 (0 desliga) */
export async function POST(request: NextRequest) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const value = (body as any)?.limit
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 0 || n > MAX_LIMIT) {
    return NextResponse.json(
      { ok: false, error: 'Informe um número inteiro entre 0 e 1.000.000 (0 = sem limite).' },
      { status: 422 }
    )
  }

  const limit = Math.floor(n)
  await settingsDb.set(ctx.tenantId, DAILY_LIMIT_SETTING_KEY, String(limit))
  return NextResponse.json({ ok: true, limit })
}
