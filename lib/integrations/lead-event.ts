/**
 * Integração de ENTRADA: eventos do produto vendido (ex.: Marcoo) que movem o cartão do lead no funil.
 *
 * Autenticação por token POR CONTA (setting `integration_inbound_token`, guardada só como hash):
 * o token tem o formato `szlead_<tenantId>.<segredo>`, então o tenant é resolvido pelo próprio
 * token e validado contra o hash salvo daquela conta. A SMARTZAP_API_KEY global não identifica
 * conta, por isso não é usada aqui.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import type { FunnelContext, FunnelApplyResult } from '@/lib/ai/funnel-classifier'

export const INBOUND_TOKEN_SETTING_KEY = 'integration_inbound_token'
export const EVENT_STAGE_MAP_SETTING_KEY = 'integration_event_stage_map'

export const leadEventSchema = z.object({
  phone: z.string().trim().min(1).max(40),
  event: z.string().trim().min(1).max(100),
  stage: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
})
export type LeadEventInput = z.infer<typeof leadEventSchema>

export interface LeadEventDeps {
  getSetting: (tenantId: string, key: string) => Promise<string | null>
  setSetting: (tenantId: string, key: string, value: string) => Promise<void>
  findContact: (tenantId: string, phone: string) => Promise<{ id: string } | null>
  createContact: (tenantId: string, c: { phone: string; name: string; email?: string }) => Promise<{ id: string }>
  resolveContext: (tenantId: string, contactId: string) => Promise<FunnelContext | null>
  applyStage: (tenantId: string, contactId: string, ctx: FunnelContext, stageName: string) => Promise<FunnelApplyResult>
}

export interface LeadEventResult {
  status: number
  body: Record<string, any>
}

function norm(s: string) {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function resolveStageName(
  input: Pick<LeadEventInput, 'event' | 'stage'>,
  map: Record<string, string>
): string | null {
  if (input.stage) return input.stage
  const mapped = map[input.event]
  return typeof mapped === 'string' && mapped.trim() ? mapped.trim() : null
}

async function loadStageMap(tenantId: string, deps: LeadEventDeps): Promise<Record<string, string>> {
  try {
    const raw = await deps.getSetting(tenantId, EVENT_STAGE_MAP_SETTING_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function idempotencyKey(input: LeadEventInput): string | null {
  if (!input.externalId) return null
  const h = createHash('sha256').update(`${input.externalId}\u0000${input.event}`).digest('hex').slice(0, 40)
  return `integration_evt_${h}`
}

export async function processLeadEvent(
  tenantId: string,
  input: LeadEventInput,
  deps: LeadEventDeps
): Promise<LeadEventResult> {
  const phone = normalizePhoneNumber(input.phone)
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return { status: 422, body: { ok: false, error: 'invalid_phone', message: 'Telefone inválido.' } }
  }

  const idemKey = idempotencyKey(input)
  if (idemKey) {
    const seen = await deps.getSetting(tenantId, idemKey)
    if (seen) {
      return { status: 200, body: { ok: true, action: 'duplicate', duplicate: true, event: input.event } }
    }
  }

  let contact = await deps.findContact(tenantId, phone)
  let contactCreated = false
  if (!contact) {
    if (!input.name) {
      return {
        status: 404,
        body: { ok: false, error: 'contact_not_found', message: 'Contato não existe; envie "name" para criá-lo.' },
      }
    }
    contact = await deps.createContact(tenantId, { phone, name: input.name, ...(input.email ? { email: input.email } : {}) })
    contactCreated = true
  }

  const map = await loadStageMap(tenantId, deps)
  const stageName = resolveStageName(input, map)
  if (!stageName) {
    return {
      status: 200,
      body: { ok: true, action: 'no_stage_mapped', contactId: contact.id, contactCreated, event: input.event },
    }
  }

  const ctx = await deps.resolveContext(tenantId, contact.id)
  if (!ctx) {
    return {
      status: 404,
      body: { ok: false, error: 'board_not_found', message: 'A conta não tem quadro de funil utilizável.' },
    }
  }
  const stage = ctx.stages.find((s) => norm(s.name) === norm(stageName))
  if (!stage) {
    return {
      status: 404,
      body: {
        ok: false,
        error: 'stage_not_found',
        message: `Fase "${stageName}" não existe no quadro "${ctx.boardName}".`,
        availableStages: ctx.stages.map((s) => s.name),
      },
    }
  }

  const result = await deps.applyStage(tenantId, contact.id, ctx, stage.name)
  if (result === 'error' || result === 'invalid_stage') {
    return { status: 502, body: { ok: false, error: 'kanban_error', message: 'Falha ao atualizar o funil; tente de novo.' } }
  }

  if (idemKey) await deps.setSetting(tenantId, idemKey, new Date().toISOString())

  return {
    status: 200,
    body: {
      ok: true,
      action: result,
      stage: stage.name,
      board: ctx.boardName,
      contactId: contact.id,
      contactCreated,
      event: input.event,
    },
  }
}

// ---------------------------------------------------------------------------
// Token por conta
// ---------------------------------------------------------------------------

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function buildInboundToken(tenantId: string): { token: string; hash: string } {
  const secret = randomBytes(24).toString('base64url')
  return { token: `szlead_${tenantId}.${secret}`, hash: hashToken(secret) }
}

export async function verifyInboundToken(
  token: string | null | undefined,
  getSetting: (tenantId: string, key: string) => Promise<string | null>
): Promise<{ ok: true; tenantId: string } | { ok: false }> {
  const raw = String(token || '').trim()
  if (!raw.startsWith('szlead_')) return { ok: false }
  const body = raw.slice('szlead_'.length)
  const dot = body.indexOf('.')
  if (dot <= 0) return { ok: false }
  const tenantId = body.slice(0, dot)
  const secret = body.slice(dot + 1)
  if (!tenantId || !secret || tenantId.length > 64) return { ok: false }

  const stored = await getSetting(tenantId, INBOUND_TOKEN_SETTING_KEY).catch(() => null)
  if (!stored) return { ok: false }
  const a = Buffer.from(hashToken(secret))
  const b = Buffer.from(stored)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false }
  return { ok: true, tenantId }
}

// ---------------------------------------------------------------------------
// Limite de requisições (janela deslizante em memória; não há util compartilhado para HTTP)
// ---------------------------------------------------------------------------
const hits = new Map<string, number[]>()

export function checkRateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}
