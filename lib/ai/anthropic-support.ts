/**
 * Suporte ao provedor Anthropic (Claude).
 *
 * Os modelos Claude atuais têm restrições que QUEBRAM chamadas (HTTP 400) se
 * tratados como Gemini/OpenAI. Tudo que é específico da Anthropic fica aqui,
 * em funções puras e testáveis:
 *
 * - `temperature` / `topP` / `topK` não padrão => 400. Nunca enviamos.
 * - Forçar tool (`toolChoice: 'required'` ou `{ type: 'tool' }`) => 400 em Opus/Sonnet.
 *   Usamos `auto` e reforçamos no prompt que a resposta final é a tool `respond`.
 * - O raciocínio (thinking) é sempre ligado: não enviamos nenhuma configuração de thinking
 *   nem `budget_tokens`. Como o raciocínio consome parte de `max_tokens`, impomos um piso.
 * - Sem prefill de mensagem de assistente.
 */

export type AnthropicModel = { id: string; name: string; description?: string }

/** Modelos oferecidos na tela de configuração (ids sem sufixo de data). */
export const ANTHROPIC_MODELS: AnthropicModel[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Mais capaz — recomendado' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Equilíbrio entre qualidade e custo' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', description: 'Rápido e econômico' },
]

/** Modelo padrão quando o provedor Anthropic é escolhido. Não altera o padrão global do sistema. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'

/**
 * Piso de `max_tokens` para a Anthropic. O raciocínio é sempre ligado e consome
 * parte do limite; com o padrão do agente (2048, ou 1024 em alguns fluxos) a
 * resposta poderia ser cortada antes de chamar a tool `respond`.
 */
export const ANTHROPIC_MIN_MAX_OUTPUT_TOKENS = 2000

/** Acrescentada ao prompt de sistema porque não podemos forçar a tool via toolChoice. */
export function buildToolInstruction(toolName: string): string {
  return `

## FORMATO DA RESPOSTA (OBRIGATÓRIO)
Sua resposta final DEVE ser dada chamando a tool "${toolName}". Nunca responda com texto solto: use sempre a tool "${toolName}" para entregar a resposta.`
}

export const ANTHROPIC_RESPOND_TOOL_INSTRUCTION = buildToolInstruction('respond')

/**
 * Resolve o id do modelo para a Anthropic. Ids de outros provedores (ex.: um agente
 * antigo com `gemini-2.5-flash`) ou vazios caem no padrão, pois dariam 404 na API.
 * Qualquer outro id `claude-*` é mantido (modelos novos não exigem deploy).
 */
export function resolveAnthropicModelId(requested?: string | null): string {
  const id = typeof requested === 'string' ? requested.trim() : ''
  return id.startsWith('claude-') ? id : DEFAULT_ANTHROPIC_MODEL
}

export type LlmProviderId = 'google' | 'openai' | 'anthropic'

export interface LlmCallSettings {
  /** undefined = não enviar toolChoice (padrão do SDK). */
  toolChoice?: 'required' | 'auto'
  /** Ausente para a Anthropic. */
  temperature?: number
  maxOutputTokens: number
  /** Texto a acrescentar ao prompt de sistema ('' quando nada). */
  systemSuffix: string
}

/**
 * Parâmetros de chamada que dependem do provedor.
 * Google/OpenAI: comportamento original. Anthropic: veja o cabeçalho do arquivo.
 */
export function buildLlmCallSettings(
  provider: LlmProviderId,
  opts: { temperature?: number; maxOutputTokens?: number; forceTool: boolean; toolName?: string },
): LlmCallSettings {
  if (provider === 'anthropic') {
    return {
      toolChoice: 'auto',
      maxOutputTokens: Math.max(opts.maxOutputTokens ?? 0, ANTHROPIC_MIN_MAX_OUTPUT_TOKENS),
      systemSuffix: opts.forceTool ? buildToolInstruction(opts.toolName ?? 'respond') : '',
    }
  }
  return {
    ...(opts.forceTool ? { toolChoice: 'required' as const } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    maxOutputTokens: opts.maxOutputTokens as number,
    systemSuffix: '',
  }
}

export const ANTHROPIC_API_VERSION = '2023-06-01'

export interface KeyValidationResult {
  valid: boolean
  error?: string
}

/**
 * Valida a chave com GET /v1/models?limit=1 (não gera tokens nem custo).
 * Mesmo padrão de validateGoogleKey / validateOpenAIKey.
 */
export async function validateAnthropicKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyValidationResult> {
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION },
    })
    if (res.ok) return { valid: true }
    if (res.status === 401)
      return { valid: false, error: 'Chave Anthropic inválida. Verifique se a chave está correta e ativa.' }
    if (res.status === 403) return { valid: false, error: 'Acesso negado. A chave pode estar desativada.' }
    if (res.status === 429)
      return { valid: false, error: 'Limite de uso excedido. Verifique seu plano Anthropic.' }
    return { valid: false, error: `Erro ao validar chave Anthropic: HTTP ${res.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    return { valid: false, error: `Erro ao validar chave Anthropic: ${message}` }
  }
}
