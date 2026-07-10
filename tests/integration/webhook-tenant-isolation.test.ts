import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getSupabaseAdmin } from '@/lib/supabase'
import { upsertWhatsAppPhoneNumber, resolveTenantByPhoneNumberId, clearWhatsAppPhoneNumber } from '@/lib/whatsapp-phone-numbers'

const hasEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY
const maybeIt = hasEnv ? it : it.skip

describe('webhook tenant isolation (integração — requer rede real)', () => {
  let tenantAId: string
  let tenantBId: string

  beforeAll(async () => {
    if (!hasEnv) return
    const db = getSupabaseAdmin()!
    const { data: a } = await db.from('tenants').insert({ name: 'wh-isolation-a', slug: `wh-isolation-a-${Date.now()}` }).select('id').single()
    const { data: b } = await db.from('tenants').insert({ name: 'wh-isolation-b', slug: `wh-isolation-b-${Date.now()}` }).select('id').single()
    tenantAId = a!.id
    tenantBId = b!.id
  })

  afterAll(async () => {
    if (!hasEnv) return
    const db = getSupabaseAdmin()!
    await clearWhatsAppPhoneNumber(tenantAId).catch(() => {})
    await clearWhatsAppPhoneNumber(tenantBId).catch(() => {})
    await db.from('tenants').delete().in('id', [tenantAId, tenantBId])
  })

  maybeIt('phone_number_id resolve para o tenant correto e reconfiguração transfere posse', async () => {
    const phoneNumberId = `pn_isolation_${Date.now()}`
    await upsertWhatsAppPhoneNumber(tenantAId, { phoneNumberId })
    expect(await resolveTenantByPhoneNumberId(phoneNumberId)).toBe(tenantAId)

    // Reconfiguração por outro tenant transfere a posse (comportamento desejado)
    await upsertWhatsAppPhoneNumber(tenantBId, { phoneNumberId })
    expect(await resolveTenantByPhoneNumberId(phoneNumberId)).toBe(tenantBId)
  })

  maybeIt('phone_number_id desconhecido não resolve nenhum tenant', async () => {
    expect(await resolveTenantByPhoneNumberId(`pn_nunca_existiu_${Date.now()}`)).toBeNull()
  })
})
