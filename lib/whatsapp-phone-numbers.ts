import { getSupabaseAdmin } from '@/lib/supabase'
import { randomUUID } from 'crypto'

export async function upsertWhatsAppPhoneNumber(
  tenantId: string,
  params: { phoneNumberId: string; businessAccountId?: string | null }
): Promise<void> {
  const db = getSupabaseAdmin()!
  const { error } = await db.from('whatsapp_phone_numbers').upsert(
    {
      phone_number_id: params.phoneNumberId,
      tenant_id: tenantId,
      business_account_id: params.businessAccountId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number_id' }
  )
  if (error) throw error
}

export async function resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db
    .from('whatsapp_phone_numbers')
    .select('tenant_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  return data?.tenant_id ?? null
}

export async function resolveTenantByFlowsWebhookToken(token: string): Promise<string | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db
    .from('whatsapp_phone_numbers')
    .select('tenant_id')
    .eq('flows_webhook_token', token)
    .maybeSingle()
  return data?.tenant_id ?? null
}

export async function getOrCreateFlowsWebhookToken(tenantId: string): Promise<string> {
  const db = getSupabaseAdmin()!
  const { data } = await db
    .from('whatsapp_phone_numbers')
    .select('flows_webhook_token')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) {
    throw new Error(
      `Tenant ${tenantId} ainda não tem número WhatsApp ativo — salve as credenciais WhatsApp antes de configurar Flows.`
    )
  }
  if (data.flows_webhook_token) return data.flows_webhook_token

  const token = `fwh_${randomUUID().replace(/-/g, '')}`
  const { error } = await db
    .from('whatsapp_phone_numbers')
    .update({ flows_webhook_token: token, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
  if (error) throw error
  return token
}

export async function clearWhatsAppPhoneNumber(tenantId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  const { error } = await db.from('whatsapp_phone_numbers').delete().eq('tenant_id', tenantId)
  if (error) throw error
}

export type WhatsAppNumberRow = {
  phone_number_id: string
  tenant_id: string
  business_account_id: string | null
  access_token: string | null
  display_label: string | null
  is_active: boolean
}
export type WhatsAppNumberPublic = Omit<WhatsAppNumberRow, 'access_token'>

const PUBLIC_COLS = 'phone_number_id, tenant_id, business_account_id, display_label, is_active'
const FULL_COLS = `${PUBLIC_COLS}, access_token`

export async function getActiveWhatsAppNumber(tenantId: string): Promise<WhatsAppNumberRow | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db.from('whatsapp_phone_numbers').select(FULL_COLS)
    .eq('tenant_id', tenantId).eq('is_active', true).maybeSingle()
  return (data as unknown as WhatsAppNumberRow) ?? null
}

export async function getWhatsAppNumberByPhoneId(tenantId: string, phoneNumberId: string): Promise<WhatsAppNumberRow | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db.from('whatsapp_phone_numbers').select(FULL_COLS)
    .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId).maybeSingle()
  return (data as unknown as WhatsAppNumberRow) ?? null
}

export async function listWhatsAppNumbers(tenantId: string): Promise<WhatsAppNumberPublic[]> {
  const db = getSupabaseAdmin()!
  const { data } = await db.from('whatsapp_phone_numbers').select(PUBLIC_COLS)
    .eq('tenant_id', tenantId).order('created_at', { ascending: true })
  return (data as unknown as WhatsAppNumberPublic[]) ?? []
}

export async function addWhatsAppNumber(
  tenantId: string,
  params: { phoneNumberId: string; businessAccountId?: string | null; accessToken: string; displayLabel?: string | null }
): Promise<WhatsAppNumberRow> {
  const db = getSupabaseAdmin()!
  const existingActive = await getActiveWhatsAppNumber(tenantId)
  const { data, error } = await db.from('whatsapp_phone_numbers').upsert(
    {
      phone_number_id: params.phoneNumberId,
      tenant_id: tenantId,
      business_account_id: params.businessAccountId ?? null,
      access_token: params.accessToken,
      display_label: params.displayLabel ?? null,
      is_active: existingActive === null, // 1º número do tenant já entra ativo
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number_id' }
  ).select(FULL_COLS).single()
  if (error) throw error
  return data as unknown as WhatsAppNumberRow
}

export async function setActiveWhatsAppNumber(tenantId: string, phoneNumberId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  // Guard de posse: só desliga o ativo se o número-alvo existe e é deste tenant.
  // Sem isso, um phone_number_id inválido/de outro tenant desligaria tudo e não
  // ligaria nada — deixando o tenant sem número ativo silenciosamente.
  const target = await getWhatsAppNumberByPhoneId(tenantId, phoneNumberId)
  if (!target) {
    throw new Error(`whatsapp number ${phoneNumberId} não encontrado para o tenant ${tenantId}`)
  }
  const off = await db.from('whatsapp_phone_numbers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('is_active', true)
  if (off.error) throw off.error
  const on = await db.from('whatsapp_phone_numbers')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId)
  if (on.error) throw on.error
}

export async function removeWhatsAppNumber(tenantId: string, phoneNumberId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  const target = await getWhatsAppNumberByPhoneId(tenantId, phoneNumberId)
  const del = await db.from('whatsapp_phone_numbers').delete()
    .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId)
  if (del.error) throw del.error
  if (target?.is_active) {
    const { data } = await db.from('whatsapp_phone_numbers').select('phone_number_id')
      .eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (data?.phone_number_id) await setActiveWhatsAppNumber(tenantId, data.phone_number_id)
  }
}
