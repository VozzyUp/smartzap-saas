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
    .maybeSingle()

  if (!data) {
    throw new Error(
      `Tenant ${tenantId} ainda não tem whatsapp_phone_numbers — salve as credenciais WhatsApp antes de configurar Flows.`
    )
  }
  if (data.flows_webhook_token) return data.flows_webhook_token

  const token = `fwh_${randomUUID().replace(/-/g, '')}`
  const { error } = await db
    .from('whatsapp_phone_numbers')
    .update({ flows_webhook_token: token, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
  if (error) throw error
  return token
}

export async function clearWhatsAppPhoneNumber(tenantId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  const { error } = await db.from('whatsapp_phone_numbers').delete().eq('tenant_id', tenantId)
  if (error) throw error
}
