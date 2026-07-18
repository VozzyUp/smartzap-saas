import { settingsDb } from '@/lib/supabase-db'
import { getActiveWhatsAppNumber, getWhatsAppNumberByPhoneId } from '@/lib/whatsapp-phone-numbers'

/**
 * WhatsApp Credentials Helper
 *
 * Fonte-first: número ativo (Fase 4, `whatsapp_phone_numbers`). Sem ativo (ou
 * ativo sem token — linha parcial), cai para o legado Supabase Settings, que
 * segue sendo espelhado pela T4. Compatível com os 47 call-sites existentes.
 */

export interface WhatsAppCredentials {
  phoneNumberId: string
  businessAccountId: string
  accessToken: string
  displayPhoneNumber?: string
  verifiedName?: string
}

function rowToCreds(row: {
  phone_number_id: string
  business_account_id: string | null
  access_token: string | null
}): WhatsAppCredentials | null {
  if (row.phone_number_id && row.business_account_id && row.access_token) {
    return {
      phoneNumberId: row.phone_number_id,
      businessAccountId: row.business_account_id,
      accessToken: row.access_token,
    }
  }
  return null
}

/**
 * Get WhatsApp credentials from database
 *
 * Ativa-first: lê o número ativo de `whatsapp_phone_numbers`; sem ativo ou
 * com linha parcial (sem access_token), cai para Supabase Settings (legado).
 */
export async function getWhatsAppCredentials(tenantId: string): Promise<WhatsAppCredentials | null> {
  try {
    const active = await getActiveWhatsAppNumber(tenantId)
    if (active) {
      const creds = rowToCreds(active)
      if (creds) return creds
    }

    const settings = await settingsDb.getAll(tenantId)

    const { phoneNumberId, businessAccountId, accessToken } = settings

    if (phoneNumberId && businessAccountId && accessToken) {
      return {
        phoneNumberId,
        businessAccountId,
        accessToken,
      }
    }

    return null
  } catch (error) {
    console.error('Error fetching WhatsApp credentials:', error)
    return null
  }
}

/**
 * Get WhatsApp credentials for a specific number (used by the inbox to reply
 * from the number a conversation belongs to). `phoneNumberId === null`
 * delega ao comportamento padrão (`getWhatsAppCredentials`, ativo-first).
 */
export async function getWhatsAppCredentialsForNumber(
  tenantId: string,
  phoneNumberId: string | null
): Promise<WhatsAppCredentials | null> {
  if (!phoneNumberId) return getWhatsAppCredentials(tenantId)
  try {
    const row = await getWhatsAppNumberByPhoneId(tenantId, phoneNumberId)
    if (row) {
      const creds = rowToCreds(row)
      if (creds) return creds
    }
    return getWhatsAppCredentials(tenantId)
  } catch (error) {
    console.error('Error fetching credentials for number:', error)
    return getWhatsAppCredentials(tenantId)
  }
}

/**
 * Check if WhatsApp is configured
 */
export async function isWhatsAppConfigured(tenantId: string): Promise<boolean> {
  const credentials = await getWhatsAppCredentials(tenantId)
  return credentials !== null
}

/**
 * Check if WhatsApp is connected (credentials exist and isConnected flag is true)
 */
export async function isWhatsAppConnected(tenantId: string): Promise<boolean> {
  try {
    const settings = await settingsDb.getAll(tenantId)
    return settings.isConnected && Boolean(settings.phoneNumberId && settings.accessToken)
  } catch {
    return false
  }
}
