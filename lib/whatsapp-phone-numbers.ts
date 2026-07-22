import { getSupabaseAdmin } from '@/lib/supabase'
import { settingsDb } from '@/lib/supabase-db'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'
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

export type WhatsAppConnectionType = 'official_api' | 'coexistence'

export type WhatsAppNumberRow = {
  phone_number_id: string
  tenant_id: string
  business_account_id: string | null
  access_token: string | null
  display_label: string | null
  display_phone_number: string | null
  is_active: boolean
  connection_type: WhatsAppConnectionType | null
}
export type WhatsAppNumberPublic = Omit<WhatsAppNumberRow, 'access_token'>

const PUBLIC_COLS = 'phone_number_id, tenant_id, business_account_id, display_label, display_phone_number, is_active, connection_type'
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
  params: {
    phoneNumberId: string
    businessAccountId?: string | null
    accessToken: string
    displayLabel?: string | null
    displayPhoneNumber?: string | null
    connectionType?: WhatsAppConnectionType | null
  }
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
      display_phone_number: params.displayPhoneNumber ?? null,
      connection_type: params.connectionType ?? null,
      is_active: existingActive === null, // 1º número do tenant já entra ativo
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number_id' }
  ).select(FULL_COLS).single()
  if (error) throw error
  return data as unknown as WhatsAppNumberRow
}

// Números existentes antes da coluna display_phone_number são enriquecidos uma
// vez pela Meta. Assim a interface não volta a exibir o Phone Number ID.
export async function refreshWhatsAppNumberDisplayPhoneNumber(
  tenantId: string,
  phoneNumberId: string
): Promise<string | null> {
  const number = await getWhatsAppNumberByPhoneId(tenantId, phoneNumberId)
  if (!number?.access_token) return null

  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${phoneNumberId}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${number.access_token}` }, timeoutMs: 8000 }
    )
    if (!response.ok) return null
    const data = await safeJson<{ display_phone_number?: string }>(response)
    const displayPhoneNumber = data?.display_phone_number?.trim()
    if (!displayPhoneNumber) return null

    const db = getSupabaseAdmin()!
    const { error } = await db.from('whatsapp_phone_numbers')
      .update({ display_phone_number: displayPhoneNumber, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId)
    if (error) throw error
    return displayPhoneNumber
  } catch (error) {
    console.warn(`[whatsapp-phone-numbers] falha ao buscar telefone de exibição para ${phoneNumberId}:`, error)
    return null
  }
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

// Espelha o número ativo do tenant em `settings`, mantendo compat com os 47
// call-sites legados de getWhatsAppCredentials/isWhatsAppConnected que ainda
// leem de lá. Sem número ativo, zera settings (isConnected=false) — nunca
// deixa credenciais obsoletas de um número removido/desativado em settings.
export async function mirrorActiveToSettings(tenantId: string): Promise<void> {
  const active = await getActiveWhatsAppNumber(tenantId)
  if (active && active.phone_number_id && active.access_token) {
    await settingsDb.saveAll(tenantId, {
      phoneNumberId: active.phone_number_id,
      businessAccountId: active.business_account_id ?? '',
      accessToken: active.access_token,
      isConnected: true,
    })
  } else {
    await settingsDb.saveAll(tenantId, {
      phoneNumberId: '',
      businessAccountId: '',
      accessToken: '',
      isConnected: false,
    })
  }
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
