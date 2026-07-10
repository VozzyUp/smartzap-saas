import { settingsDb } from '@/lib/supabase-db'
import { isSupabaseConfigured, getSupabaseAdmin } from '@/lib/supabase'
import { getAppUrl } from '@/lib/app-url'

const SETTINGS_KEYS = {
  tokens: 'google_calendar_tokens',
  config: 'google_calendar_config',
  channel: 'google_calendar_channel',
  clientId: 'googleCalendarClientId',
  clientSecret: 'googleCalendarClientSecret',
} as const

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
]

export type GoogleCalendarTokens = {
  accessToken: string
  refreshToken?: string | null
  expiryDate?: number | null
  scope?: string | null
  tokenType?: string | null
}

export type GoogleCalendarConfig = {
  calendarId: string
  calendarSummary?: string | null
  calendarTimeZone?: string | null
  connectedAt?: string | null
  accountEmail?: string | null
}

export type GoogleCalendarChannel = {
  id: string
  resourceId: string
  token: string
  expiration?: number | null
  calendarId: string
  createdAt: string
  lastNotificationAt?: string | null
  lastResourceState?: string | null
}

export type GoogleCalendarCredentialsSource = 'db' | 'env' | 'none'

export type GoogleCalendarCredentials = {
  clientId: string
  clientSecret: string
  source: GoogleCalendarCredentialsSource
}

export type GoogleCalendarCredentialsPublic = {
  clientId: string | null
  source: GoogleCalendarCredentialsSource
  hasClientSecret: boolean
  isConfigured: boolean
}

function getBaseUrl(): string {
  return getAppUrl()
}

export function getGoogleCalendarRedirectUri(): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${getBaseUrl()}/api/integrations/google-calendar/callback`
}

export function getGoogleCalendarWebhookUrl(): string {
  return process.env.GOOGLE_CALENDAR_WEBHOOK_URL || `${getBaseUrl()}/api/integrations/google-calendar/webhook`
}

export async function getGoogleCalendarCredentials(tenantId: string): Promise<GoogleCalendarCredentials | null> {
  const envClientId = String(process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim()
  const envClientSecret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim()

  if (isSupabaseConfigured()) {
    try {
      const [dbClientIdRaw, dbClientSecretRaw] = await Promise.all([
        settingsDb.get(tenantId, SETTINGS_KEYS.clientId),
        settingsDb.get(tenantId, SETTINGS_KEYS.clientSecret),
      ])
      const dbClientId = String(dbClientIdRaw || '').trim()
      const dbClientSecret = String(dbClientSecretRaw || '').trim()

      if (dbClientId && dbClientSecret) {
        return { clientId: dbClientId, clientSecret: dbClientSecret, source: 'db' }
      }
    } catch {
      // ignore and fallback to env
    }
  }

  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret, source: 'env' }
  }

  return null
}

export async function getGoogleCalendarCredentialsPublic(tenantId: string): Promise<GoogleCalendarCredentialsPublic> {
  const envClientId = String(process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim()
  const envClientSecret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim()

  if (isSupabaseConfigured()) {
    try {
      const [dbClientIdRaw, dbClientSecretRaw] = await Promise.all([
        settingsDb.get(tenantId, SETTINGS_KEYS.clientId),
        settingsDb.get(tenantId, SETTINGS_KEYS.clientSecret),
      ])
      const dbClientId = String(dbClientIdRaw || '').trim()
      const dbClientSecret = String(dbClientSecretRaw || '').trim()
      if (dbClientId || dbClientSecret) {
        const hasSecret = Boolean(dbClientSecret)
        return {
          clientId: dbClientId || null,
          source: 'db',
          hasClientSecret: hasSecret,
          isConfigured: Boolean(dbClientId && dbClientSecret),
        }
      }
    } catch {
      // ignore
    }
  }

  const hasEnv = Boolean(envClientId || envClientSecret)
  if (hasEnv) {
    return {
      clientId: envClientId || null,
      source: 'env',
      hasClientSecret: Boolean(envClientSecret),
      isConfigured: Boolean(envClientId && envClientSecret),
    }
  }

  return {
    clientId: null,
    source: 'none',
    hasClientSecret: false,
    isConfigured: false,
  }
}

export async function getGoogleCalendarOAuthConfig(tenantId: string): Promise<{
  clientId: string
  clientSecret: string
} | null> {
  const credentials = await getGoogleCalendarCredentials(tenantId)
  if (!credentials) return null
  return { clientId: credentials.clientId, clientSecret: credentials.clientSecret }
}

export async function buildGoogleCalendarAuthUrl(tenantId: string, state: string): Promise<string> {
  const config = await getGoogleCalendarOAuthConfig(tenantId)
  if (!config) {
    throw new Error('Google Calendar OAuth nao configurado')
  }
  const redirectUri = getGoogleCalendarRedirectUri()

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_SCOPES.join(' '),
    state,
  })

  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`
}

function randomToken(prefix: string): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`
    }
  } catch {
    // ignore
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function createOAuthState(): string {
  return randomToken('gc_state')
}

export function createChannelToken(): string {
  return randomToken('gc_token')
}

export async function exchangeCodeForTokens(tenantId: string, code: string): Promise<GoogleCalendarTokens> {
  const config = await getGoogleCalendarOAuthConfig(tenantId)
  if (!config) throw new Error('Google Calendar OAuth nao configurado')

  const redirectUri = getGoogleCalendarRedirectUri()

  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((json as any)?.error_description || (json as any)?.error || 'Falha ao trocar code')
  }

  return {
    accessToken: String((json as any).access_token || ''),
    refreshToken: (json as any).refresh_token ? String((json as any).refresh_token) : null,
    expiryDate: (json as any).expires_in ? Date.now() + Number((json as any).expires_in) * 1000 : null,
    scope: (json as any).scope ? String((json as any).scope) : null,
    tokenType: (json as any).token_type ? String((json as any).token_type) : null,
  }
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  if (!accessToken) return null
  try {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) return null
    const email = typeof (json as any).email === 'string' ? String((json as any).email) : ''
    return email.trim() ? email.trim() : null
  } catch (error) {
    console.warn('[google-calendar] Falha ao obter email:', error)
    return null
  }
}

async function refreshAccessToken(tenantId: string, refreshToken: string): Promise<GoogleCalendarTokens> {
  const config = await getGoogleCalendarOAuthConfig(tenantId)
  if (!config) throw new Error('Google Calendar OAuth nao configurado')

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((json as any)?.error_description || (json as any)?.error || 'Falha ao renovar token')
  }

  return {
    accessToken: String((json as any).access_token || ''),
    refreshToken,
    expiryDate: (json as any).expires_in ? Date.now() + Number((json as any).expires_in) * 1000 : null,
    scope: (json as any).scope ? String((json as any).scope) : null,
    tokenType: (json as any).token_type ? String((json as any).token_type) : null,
  }
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const body = new URLSearchParams({ token })
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => null)
}

export async function getStoredTokens(tenantId: string): Promise<GoogleCalendarTokens | null> {
  if (!isSupabaseConfigured()) return null
  const raw = await settingsDb.get(tenantId, SETTINGS_KEYS.tokens)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.accessToken) return null
    return parsed as GoogleCalendarTokens
  } catch {
    return null
  }
}

export async function saveTokens(tenantId: string, tokens: GoogleCalendarTokens): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado')
  }
  await settingsDb.set(tenantId, SETTINGS_KEYS.tokens, JSON.stringify(tokens))
}

export async function clearTokens(tenantId: string): Promise<void> {
  if (!isSupabaseConfigured()) return
  await settingsDb.set(tenantId, SETTINGS_KEYS.tokens, '')
}

export async function getCalendarConfig(tenantId: string): Promise<GoogleCalendarConfig | null> {
  if (!isSupabaseConfigured()) return null
  const raw = await settingsDb.get(tenantId, SETTINGS_KEYS.config)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.calendarId) return null
    return parsed as GoogleCalendarConfig
  } catch {
    return null
  }
}

export async function saveCalendarConfig(tenantId: string, config: GoogleCalendarConfig): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado')
  }
  await settingsDb.set(tenantId, SETTINGS_KEYS.config, JSON.stringify(config))
}

export async function clearCalendarConfig(tenantId: string): Promise<void> {
  if (!isSupabaseConfigured()) return
  await settingsDb.set(tenantId, SETTINGS_KEYS.config, '')
}

export async function getCalendarChannel(tenantId: string): Promise<GoogleCalendarChannel | null> {
  if (!isSupabaseConfigured()) return null
  const raw = await settingsDb.get(tenantId, SETTINGS_KEYS.channel)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.id || !parsed?.resourceId) return null
    return parsed as GoogleCalendarChannel
  } catch {
    return null
  }
}

export async function saveCalendarChannel(tenantId: string, channel: GoogleCalendarChannel | null): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado')
  }
  if (!channel) {
    await settingsDb.set(tenantId, SETTINGS_KEYS.channel, '')
    await getSupabaseAdmin()!
      .from('google_calendar_channels')
      .delete()
      .eq('tenant_id', tenantId)
    return
  }
  await settingsDb.set(tenantId, SETTINGS_KEYS.channel, JSON.stringify(channel))
  const { error } = await getSupabaseAdmin()!
    .from('google_calendar_channels')
    .upsert(
      {
        channel_token: channel.token,
        tenant_id: tenantId,
        channel_id: channel.id,
        resource_id: channel.resourceId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel_token' }
    )
  if (error) throw error
}

export async function resolveTenantByChannelToken(channelToken: string): Promise<string | null> {
  const db = getSupabaseAdmin()
  if (!db) return null
  const { data } = await db
    .from('google_calendar_channels')
    .select('tenant_id')
    .eq('channel_token', channelToken)
    .maybeSingle()
  return data?.tenant_id ?? null
}

export async function ensureAccessToken(tenantId: string): Promise<GoogleCalendarTokens> {
  const current = await getStoredTokens(tenantId)
  if (!current) throw new Error('Google Calendar nao conectado')

  const expiresAt = current.expiryDate || 0
  const safeWindowMs = 60 * 1000
  if (expiresAt && Date.now() < expiresAt - safeWindowMs) {
    return current
  }

  if (!current.refreshToken) {
    return current
  }

  const refreshed = await refreshAccessToken(tenantId, current.refreshToken)
  const merged = { ...current, ...refreshed }
  await saveTokens(tenantId, merged)
  return merged
}

async function googleCalendarFetch(tenantId: string, path: string, init?: RequestInit): Promise<any> {
  const token = await ensureAccessToken(tenantId)
  const response = await fetch(`${GOOGLE_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.accessToken}`,
      ...(init?.headers || {}),
    },
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (json as any)?.error?.message || (json as any)?.error || 'Falha na chamada Google Calendar'
    throw new Error(message)
  }
  return json
}

export async function listCalendars(tenantId: string): Promise<any[]> {
  const data = await googleCalendarFetch(tenantId, '/users/me/calendarList')
  return Array.isArray(data?.items) ? data.items : []
}

export async function getCalendar(tenantId: string, calendarId: string): Promise<any> {
  return googleCalendarFetch(tenantId, `/calendars/${encodeURIComponent(calendarId)}`)
}

export async function listBusyTimes(tenantId: string, params: {
  calendarId: string
  timeMin: string
  timeMax: string
  timeZone?: string
}): Promise<Array<{ start: string; end: string }>> {
  const data = await googleCalendarFetch(tenantId, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      timeZone: params.timeZone,
      items: [{ id: params.calendarId }],
    }),
  })

  const busy = data?.calendars?.[params.calendarId]?.busy
  if (!Array.isArray(busy)) return []
  return busy.map((item: any) => ({
    start: String(item.start),
    end: String(item.end),
  }))
}

export async function createEvent(tenantId: string, params: {
  calendarId: string
  event: Record<string, unknown>
}): Promise<any> {
  return googleCalendarFetch(tenantId, `/calendars/${encodeURIComponent(params.calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(params.event),
  })
}

export async function stopWatchChannel(tenantId: string, channel: { id: string; resourceId: string }): Promise<void> {
  try {
    await googleCalendarFetch(tenantId, '/channels/stop', {
      method: 'POST',
      body: JSON.stringify({ id: channel.id, resourceId: channel.resourceId }),
    })
  } catch (error) {
    console.warn('[google-calendar] Falha ao parar channel:', error)
  }
}

export async function createWatchChannel(tenantId: string, params: {
  calendarId: string
  channelId: string
  channelToken: string
  address: string
}): Promise<GoogleCalendarChannel> {
  const data = await googleCalendarFetch(tenantId, `/calendars/${encodeURIComponent(params.calendarId)}/events/watch`, {
    method: 'POST',
    body: JSON.stringify({
      id: params.channelId,
      type: 'web_hook',
      address: params.address,
      token: params.channelToken,
    }),
  })

  return {
    id: String(data.id || params.channelId),
    resourceId: String(data.resourceId || ''),
    token: params.channelToken,
    expiration: data.expiration ? Number(data.expiration) : null,
    calendarId: params.calendarId,
    createdAt: new Date().toISOString(),
  }
}

export async function buildDefaultCalendarConfig(tenantId: string, accountEmail?: string | null): Promise<GoogleCalendarConfig> {
  const calendars = await listCalendars(tenantId)
  const primary = calendars.find((item: any) => item.primary) || calendars[0]
  if (!primary) {
    throw new Error('Nenhum calendario encontrado')
  }
  return {
    calendarId: String(primary.id),
    calendarSummary: String(primary.summary || ''),
    calendarTimeZone: primary.timeZone ? String(primary.timeZone) : null,
    connectedAt: new Date().toISOString(),
    accountEmail: accountEmail || null,
  }
}

export async function ensureCalendarChannel(tenantId: string, calendarId: string): Promise<GoogleCalendarChannel> {
  const existing = await getCalendarChannel(tenantId)
  const now = Date.now()
  if (existing && existing.calendarId === calendarId) {
    const expiresAt = existing.expiration || 0
    const renewWindow = 24 * 60 * 60 * 1000
    if (!expiresAt || expiresAt - now > renewWindow) {
      return existing
    }
  }

  if (existing?.id && existing.resourceId) {
    await stopWatchChannel(tenantId, { id: existing.id, resourceId: existing.resourceId })
  }

  const channelId = randomToken('gc_channel')
  const channelToken = createChannelToken()
  const address = getGoogleCalendarWebhookUrl()
  const channel = await createWatchChannel(tenantId, {
    calendarId,
    channelId,
    channelToken,
    address,
  })
  await saveCalendarChannel(tenantId, channel)
  return channel
}

export async function clearCalendarIntegration(tenantId: string): Promise<void> {
  const channel = await getCalendarChannel(tenantId)
  if (channel?.id && channel.resourceId) {
    await stopWatchChannel(tenantId, { id: channel.id, resourceId: channel.resourceId })
  }
  await saveCalendarChannel(tenantId, null)
  await clearCalendarConfig(tenantId)
  await clearTokens(tenantId)
}

export async function markCalendarNotification(tenantId: string, params: {
  resourceState?: string | null
}): Promise<void> {
  const channel = await getCalendarChannel(tenantId)
  if (!channel) return
  const updated: GoogleCalendarChannel = {
    ...channel,
    lastNotificationAt: new Date().toISOString(),
    lastResourceState: params.resourceState || channel.lastResourceState || null,
  }
  await saveCalendarChannel(tenantId, updated)
}
