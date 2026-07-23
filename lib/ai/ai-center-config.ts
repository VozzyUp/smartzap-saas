import { supabase } from '@/lib/supabase'
import {
  DEFAULT_AI_DIRECT,
  DEFAULT_AI_PROMPTS,
  DEFAULT_AI_ROUTES,
  type AiDirectConfig,
  type AiProviderType,
  type AiPromptsConfig,
  type AiRoutesConfig,
} from './ai-center-defaults'

const SETTINGS_KEYS = {
  routes: 'ai_routes',
  direct: 'ai_direct',
  prompts: 'ai_prompts',
  googleApiKey: 'google_api_key',
  openaiApiKey: 'openai_api_key',
  // Chaves individuais para prompts de estratégia (fonte única de verdade: banco)
  strategyMarketing: 'strategyMarketing',
  strategyUtility: 'strategyUtility',
  strategyBypass: 'strategyBypass',
} as const

const CACHE_TTL = 60000

// Caches por-tenant: a config de IA (chaves, provider, prompts, rotas) é
// isolada por tenant. Um cache global vazaria a config de um tenant pra
// outro — exatamente o bug que esta estrutura corrige.
type CacheEntry<T> = { value: T; time: number }
const cachedRoutesByTenant = new Map<string, CacheEntry<AiRoutesConfig>>()
const cachedDirectByTenant = new Map<string, CacheEntry<AiDirectConfig>>()
const cachedPromptsByTenant = new Map<string, CacheEntry<AiPromptsConfig>>()

function readCache<T>(map: Map<string, CacheEntry<T>>, tenantId: string): T | null {
  const entry = map.get(tenantId)
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.value
  return null
}

function writeCache<T>(map: Map<string, CacheEntry<T>>, tenantId: string, value: T): void {
  map.set(tenantId, { value, time: Date.now() })
}

function parseJsonSetting<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeRoutes(input?: Partial<AiRoutesConfig> | null): AiRoutesConfig {
  const next = { ...DEFAULT_AI_ROUTES, ...(input || {}) }
  return {
    generateUtilityTemplates: !!next.generateUtilityTemplates,
    generateFlowForm: !!next.generateFlowForm,
  }
}

function normalizeDirect(
  input?: Partial<Pick<AiDirectConfig, 'provider' | 'model'>> | null,
  googleApiKey?: string | null,
  openaiApiKey?: string | null,
): AiDirectConfig {
  const provider: AiProviderType =
    input?.provider === 'google' || input?.provider === 'openai'
      ? input.provider
      : DEFAULT_AI_DIRECT.provider

  const model =
    typeof input?.model === 'string' && input.model.trim()
      ? input.model.trim()
      : DEFAULT_AI_DIRECT.model

  return {
    provider,
    model,
    ...(googleApiKey ? { googleApiKey } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
  }
}

// Normaliza prompts gerais (usa defaults do código como fallback)
function normalizeBasePrompts(input?: Partial<AiPromptsConfig> | null): Omit<AiPromptsConfig, 'strategyMarketing' | 'strategyUtility' | 'strategyBypass'> {
  const next = { ...DEFAULT_AI_PROMPTS, ...(input || {}) }
  return {
    utilityGenerationTemplate: next.utilityGenerationTemplate || DEFAULT_AI_PROMPTS.utilityGenerationTemplate,
    utilityJudgeTemplate: next.utilityJudgeTemplate || DEFAULT_AI_PROMPTS.utilityJudgeTemplate,
    flowFormTemplate: next.flowFormTemplate || DEFAULT_AI_PROMPTS.flowFormTemplate,
  }
}

// Normaliza prompts de estratégia (banco tem prioridade, código é fallback)
function normalizeStrategyPrompts(strategies: {
  marketing: string | null
  utility: string | null
  bypass: string | null
}): Pick<AiPromptsConfig, 'strategyMarketing' | 'strategyUtility' | 'strategyBypass'> {
  return {
    strategyMarketing: strategies.marketing || DEFAULT_AI_PROMPTS.strategyMarketing,
    strategyUtility: strategies.utility || DEFAULT_AI_PROMPTS.strategyUtility,
    strategyBypass: strategies.bypass || DEFAULT_AI_PROMPTS.strategyBypass,
  }
}

// Função de compatibilidade para preparar updates
function normalizePrompts(input?: Partial<AiPromptsConfig> | null): AiPromptsConfig {
  const next = { ...DEFAULT_AI_PROMPTS, ...(input || {}) }
  return {
    utilityGenerationTemplate: next.utilityGenerationTemplate || DEFAULT_AI_PROMPTS.utilityGenerationTemplate,
    utilityJudgeTemplate: next.utilityJudgeTemplate || DEFAULT_AI_PROMPTS.utilityJudgeTemplate,
    flowFormTemplate: next.flowFormTemplate || DEFAULT_AI_PROMPTS.flowFormTemplate,
    strategyMarketing: next.strategyMarketing || '',
    strategyUtility: next.strategyUtility || '',
    strategyBypass: next.strategyBypass || '',
  }
}

async function getSettingValue(tenantId: string, key: string): Promise<string | null> {
  const { data, error } = await supabase.admin
    ?.from('settings')
    .select('value')
    .eq('key', key)
    .eq('tenant_id', tenantId)
    .single() || { data: null, error: null }

  if (error || !data) return null
  return data.value
}

export async function getAiRoutesConfig(tenantId: string): Promise<AiRoutesConfig> {
  const cached = readCache(cachedRoutesByTenant, tenantId)
  if (cached) return cached
  const raw = await getSettingValue(tenantId, SETTINGS_KEYS.routes)
  const parsed = parseJsonSetting<Partial<AiRoutesConfig>>(raw, DEFAULT_AI_ROUTES)
  const routes = normalizeRoutes(parsed)
  writeCache(cachedRoutesByTenant, tenantId, routes)
  return routes
}

/**
 * Retorna a configuração de provider direto, incluindo as chaves de API do Supabase.
 * As chaves não são expostas na UI — apenas presença é verificada.
 */
export async function getAiDirectConfig(tenantId: string): Promise<AiDirectConfig> {
  const cached = readCache(cachedDirectByTenant, tenantId)
  if (cached) return cached

  const [rawDirect, googleApiKey, geminiApiKeyLegacy, openaiApiKey] = await Promise.all([
    getSettingValue(tenantId, SETTINGS_KEYS.direct),
    getSettingValue(tenantId, SETTINGS_KEYS.googleApiKey),
    getSettingValue(tenantId, 'gemini_api_key'), // retrocompatibilidade: chave pode estar salva com nome antigo
    getSettingValue(tenantId, SETTINGS_KEYS.openaiApiKey),
  ])

  const parsed = parseJsonSetting<Partial<Pick<AiDirectConfig, 'provider' | 'model'>>>(rawDirect, {})
  const direct = normalizeDirect(parsed, googleApiKey || geminiApiKeyLegacy, openaiApiKey)
  writeCache(cachedDirectByTenant, tenantId, direct)
  return direct
}

export async function getAiPromptsConfig(tenantId: string): Promise<AiPromptsConfig> {
  const cached = readCache(cachedPromptsByTenant, tenantId)
  if (cached) return cached

  const rawBase = await getSettingValue(tenantId, SETTINGS_KEYS.prompts)
  const parsedBase = parseJsonSetting<Partial<AiPromptsConfig>>(rawBase, {})
  const basePrompts = normalizeBasePrompts(parsedBase)

  const [marketing, utility, bypass] = await Promise.all([
    getSettingValue(tenantId, SETTINGS_KEYS.strategyMarketing),
    getSettingValue(tenantId, SETTINGS_KEYS.strategyUtility),
    getSettingValue(tenantId, SETTINGS_KEYS.strategyBypass),
  ])
  const strategyPrompts = normalizeStrategyPrompts({ marketing, utility, bypass })

  const prompts = { ...basePrompts, ...strategyPrompts }
  writeCache(cachedPromptsByTenant, tenantId, prompts)
  return prompts
}

export async function isAiRouteEnabled(tenantId: string, routeKey: keyof AiRoutesConfig): Promise<boolean> {
  const routes = await getAiRoutesConfig(tenantId)
  return routes[routeKey]
}

export function prepareAiRoutesUpdate(input?: Partial<AiRoutesConfig> | null): AiRoutesConfig {
  return normalizeRoutes(input)
}

export function prepareAiDirectUpdate(input?: Partial<Pick<AiDirectConfig, 'provider' | 'model'>> | null): Pick<AiDirectConfig, 'provider' | 'model'> {
  return normalizeDirect(input)
}

export function prepareAiPromptsUpdate(input?: Partial<AiPromptsConfig> | null): AiPromptsConfig {
  return normalizePrompts(input)
}

export function clearAiCenterCache(tenantId: string) {
  cachedRoutesByTenant.delete(tenantId)
  cachedDirectByTenant.delete(tenantId)
  cachedPromptsByTenant.delete(tenantId)
}
