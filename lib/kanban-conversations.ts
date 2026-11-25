import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'

export type ContactRef = { id: string; phone: string | null | undefined }

export type ConversationRow = {
  id: string
  contact_id: string | null
  phone: string | null
  last_message_at: string | null
  created_at?: string | null
}

function safeNormalize(phone: string | null | undefined): string {
  if (!phone) return ''
  try {
    return normalizePhoneNumber(phone)
  } catch {
    return phone.replace(/[^\d]/g, '')
  }
}

function recency(row: ConversationRow): number {
  const t = Date.parse(row.last_message_at ?? row.created_at ?? '')
  return Number.isNaN(t) ? -Infinity : t
}

function newest(rows: ConversationRow[]): ConversationRow | undefined {
  let best: ConversationRow | undefined
  for (const r of rows) if (!best || recency(r) > recency(best)) best = r
  return best
}

/**
 * Escolhe, para cada contato, a conversa mais recente. Casa por contact_id quando
 * existir; senão, por telefone normalizado. Função pura (sem acesso a banco).
 */
export function pickConversationIds(contacts: ContactRef[], rows: ConversationRow[]): Map<string, string> {
  const byContact = new Map<string, ConversationRow[]>()
  const byPhone = new Map<string, ConversationRow[]>()
  for (const row of rows) {
    if (row.contact_id) {
      const l = byContact.get(row.contact_id) ?? []
      l.push(row)
      byContact.set(row.contact_id, l)
    }
    const p = safeNormalize(row.phone)
    if (p) {
      const l = byPhone.get(p) ?? []
      l.push(row)
      byPhone.set(p, l)
    }
  }
  const result = new Map<string, string>()
  for (const c of contacts) {
    const direct = newest(byContact.get(c.id) ?? [])
    const phone = safeNormalize(c.phone)
    const found = direct ?? (phone ? newest(byPhone.get(phone) ?? []) : undefined)
    if (found) result.set(c.id, found.id)
  }
  return result
}

/**
 * Resolve em lote (1 consulta) a conversa mais recente de cada contato, filtrando pela conta.
 */
export async function resolveConversationIdsForContacts(
  tenantId: string,
  contacts: ContactRef[]
): Promise<Map<string, string>> {
  if (contacts.length === 0) return new Map()
  const ids = [...new Set(contacts.map((c) => c.id))]
  const phones = new Set<string>()
  for (const c of contacts) {
    const n = safeNormalize(c.phone)
    if (n) phones.add(n)
  }
  const conds = [`contact_id.in.(${ids.join(',')})`]
  if (phones.size > 0) conds.push(`phone.in.(${[...phones].map((p) => `"${p}"`).join(',')})`)

  const { data, error } = await getSupabaseAdmin()!
    .from('inbox_conversations')
    .select('id, contact_id, phone, last_message_at, created_at')
    .eq('tenant_id', tenantId)
    .or(conds.join(','))
  if (error || !data) return new Map()
  return pickConversationIds(contacts, data as ConversationRow[])
}
