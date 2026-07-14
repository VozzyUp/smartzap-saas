/**
 * Embedding Providers API
 * Retorna quais providers de embedding estão disponíveis (têm API key configurada)
 */

import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { settingsDb } from '@/lib/supabase-db'
import { EMBEDDING_PROVIDERS } from '@/lib/ai/embeddings'
import type { EmbeddingProvider } from '@/types'

// Mapeamento de provider para chave de API na tabela settings
const EMBEDDING_API_KEY_MAP: Record<EmbeddingProvider, { settingKey: string; envVar: string }> = {
  google: { settingKey: 'google_api_key', envVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  openai: { settingKey: 'openai_api_key', envVar: 'OPENAI_API_KEY' },
  voyage: { settingKey: 'voyage_api_key', envVar: 'VOYAGE_API_KEY' },
  cohere: { settingKey: 'cohere_api_key', envVar: 'COHERE_API_KEY' },
}

/**
 * GET /api/ai-agents/embedding-providers
 * Retorna lista de providers com status de disponibilidade
 */
export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Busca todas as API keys de embedding de uma vez
    const settingKeys = Object.values(EMBEDDING_API_KEY_MAP).map(c => c.settingKey)

    const values = await Promise.all(
      settingKeys.map((key) => settingsDb.get(ctx.tenantId as string, key))
    )

    // Cria mapa de quais keys existem
    const configuredKeys = new Set(
      settingKeys.filter((key, i) => values[i] && values[i]!.trim() !== '')
    )

    // Verifica também env vars
    const availableProviders = EMBEDDING_PROVIDERS.map(provider => {
      const config = EMBEDDING_API_KEY_MAP[provider.id]
      const hasApiKey =
        configuredKeys.has(config.settingKey) ||
        Boolean(process.env[config.envVar])

      return {
        ...provider,
        available: hasApiKey,
        reason: hasApiKey ? null : `API key não configurada`,
      }
    })

    return NextResponse.json({
      providers: availableProviders,
    })
  } catch (error) {
    console.error('[embedding-providers] Error:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar providers' },
      { status: 500 }
    )
  }
}
