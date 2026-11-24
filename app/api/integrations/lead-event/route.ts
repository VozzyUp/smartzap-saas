/**
 * POST /api/integrations/lead-event
 * Evento do produto vendido (ex.: Marcoo) que cria/move o cartão do lead no funil.
 * Auth: token por conta (`Authorization: Bearer szlead_<conta>.<segredo>` ou `X-API-Key`).
 * Rota pública no proxy (sem sessão): a autenticação é feita aqui.
 */
import { NextRequest, NextResponse } from 'next/server'
import { settingsDb, contactDb } from '@/lib/supabase-db'
import { applyFunnelClassification, resolveFunnelContext } from '@/lib/ai/funnel-classifier'
import { ContactStatus } from '@/types'
import {
  checkRateLimit,
  leadEventSchema,
  processLeadEvent,
  verifyInboundToken,
  type LeadEventDeps,
} from '@/lib/integrations/lead-event'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_MAX = 120
const RATE_WINDOW_MS = 60_000

const deps: LeadEventDeps = {
  getSetting: (t, k) => settingsDb.get(t, k),
  setSetting: (t, k, v) => settingsDb.set(t, k, v),
  findContact: async (t, phone) => {
    const c = await contactDb.getByPhone(t, phone)
    return c ? { id: c.id } : null
  },
  createContact: async (t, c) => {
    const created = await contactDb.add(t, {
      name: c.name,
      phone: c.phone,
      email: c.email ?? null,
      status: ContactStatus.OPT_IN,
      tags: [],
      custom_fields: {},
    } as any)
    return { id: created.id }
  },
  resolveContext: (t, contactId) => resolveFunnelContext(t, contactId),
  applyStage: (t, contactId, ctx, stage) => applyFunnelClassification(t, contactId, ctx, stage),
}

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return request.headers.get('x-api-key')
}

export async function POST(request: NextRequest) {
  const auth = await verifyInboundToken(extractToken(request), (t, k) => settingsDb.get(t, k))
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!checkRateLimit(`lead-event:${auth.tenantId}`, RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const json = await request.json().catch(() => null)
  const parsed = leadEventSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 422 }
    )
  }

  try {
    const result = await processLeadEvent(auth.tenantId, parsed.data, deps)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('[lead-event] erro inesperado:', error)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
