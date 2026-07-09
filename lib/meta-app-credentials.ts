import { settingsDb } from '@/lib/supabase-db'

export interface MetaAppCredentials {
  appId: string
  appSecret: string
}

/**
 * Retorna apenas o App ID (sem exigir secret).
 *
 * Necessário para APIs da Meta que usam caminhos baseados em /{app_id}/...
 * (ex.: Resumable Upload API) mas não exigem appSecret.
 *
 * Fonte única: Supabase Settings (configurado via UI)
 */
export async function getMetaAppId(tenantId: string): Promise<string | null> {
  try {
    const dbAppIdRaw = await settingsDb.get(tenantId, 'metaAppId')
    const appId = String(dbAppIdRaw || '').trim()
    return appId || null
  } catch {
    return null
  }
}

/**
 * Credenciais do App da Meta (opcional).
 *
 * Usadas para validação forte de tokens via Graph API `/debug_token`.
 *
 * Fonte única: Supabase Settings (configurado via UI)
 */
export async function getMetaAppCredentials(tenantId: string): Promise<MetaAppCredentials | null> {
  try {
    const [dbAppId, dbSecret] = await Promise.all([
      settingsDb.get(tenantId, 'metaAppId'),
      settingsDb.get(tenantId, 'metaAppSecret'),
    ])

    const appId = String(dbAppId || '').trim()
    const appSecret = String(dbSecret || '').trim()

    if (!appId || !appSecret) return null

    return { appId, appSecret }
  } catch {
    return null
  }
}

/**
 * Retorna configuração pública do Meta App (sem expor secret)
 */
export async function getMetaAppConfigPublic(tenantId: string): Promise<{
  appId: string | null
  hasAppSecret: boolean
  isConfigured: boolean
}> {
  try {
    const [dbAppIdRaw, dbSecretRaw] = await Promise.all([
      settingsDb.get(tenantId, 'metaAppId'),
      settingsDb.get(tenantId, 'metaAppSecret'),
    ])

    const appId = String(dbAppIdRaw || '').trim() || null
    const hasAppSecret = Boolean(String(dbSecretRaw || '').trim())

    return {
      appId,
      hasAppSecret,
      isConfigured: Boolean(appId && hasAppSecret),
    }
  } catch {
    return {
      appId: null,
      hasAppSecret: false,
      isConfigured: false,
    }
  }
}
