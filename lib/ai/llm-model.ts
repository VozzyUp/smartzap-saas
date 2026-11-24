/**
 * Fábrica única do modelo de linguagem a partir da config da conta
 * (Google / OpenAI / Anthropic). Usada pelas rotas e serviços que antes
 * repetiam o `if (provider === 'google') ... else openai`.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { DEFAULT_MODEL_ID } from '@/lib/ai/model'
import { resolveAnthropicModelId } from './anthropic-support'
import type { AiDirectConfig } from './ai-center-defaults'

export function createLanguageModel(config: AiDirectConfig, requestedModelId?: string | null) {
  if (config.provider === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('Chave Anthropic não configurada. Acesse Configurações → IA.')
    // Id de outro provedor (agente antigo com gemini-*) cai em claude-opus-5-5
    const modelId = resolveAnthropicModelId(requestedModelId || config.model)
    return { model: createAnthropic({ apiKey: config.anthropicApiKey })(modelId), modelId }
  }

  const modelId = requestedModelId || config.model || DEFAULT_MODEL_ID
  if (config.provider === 'google') {
    if (!config.googleApiKey) throw new Error('Chave Google não configurada. Acesse Configurações → IA.')
    return { model: createGoogleGenerativeAI({ apiKey: config.googleApiKey })(modelId), modelId }
  }
  if (!config.openaiApiKey) throw new Error('Chave OpenAI não configurada. Acesse Configurações → IA.')
  return { model: createOpenAI({ apiKey: config.openaiApiKey })(modelId), modelId }
}
