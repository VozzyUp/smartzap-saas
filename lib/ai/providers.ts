/**
 * AI Providers Configuration
 *
 * Lista mínima de fallback. Modelos reais são carregados dinamicamente
 * via GET /api/ai/models?provider=google|openai após o usuário configurar a chave.
 *
 * Providers suportados: Google Gemini, OpenAI e Anthropic (Claude).
 */

import { ANTHROPIC_MODELS } from './anthropic-support';

export type AIProvider = 'google' | 'openai' | 'anthropic';

export interface AIModel {
    id: string;
    name: string;
    description?: string;
}

export interface AIProviderConfig {
    id: AIProvider;
    name: string;
    icon: string;
    models: AIModel[];
}

export const AI_PROVIDERS: AIProviderConfig[] = [
    {
        id: 'google',
        name: 'Google (Gemini)',
        icon: '💎',
        models: [
            { id: 'gemini-flash-latest', name: 'Gemini Flash (sempre atual)', description: 'Alias auto-atualizado — recomendado' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Rápido e eficiente' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Melhor para tarefas complexas' },
        ],
    },
    {
        id: 'openai',
        name: 'OpenAI (GPT)',
        icon: '🤖',
        models: [
            { id: 'gpt-4o', name: 'GPT-4o', description: 'Modelo principal' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Rápido e econômico' },
        ],
    },
    {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        icon: '🧠',
        models: ANTHROPIC_MODELS,
    },
];

/**
 * Get provider config by ID
 */
export function getProvider(providerId: AIProvider): AIProviderConfig | undefined {
    return AI_PROVIDERS.find(p => p.id === providerId);
}

/**
 * Get model config by ID
 */
export function getModel(providerId: AIProvider, modelId: string): AIModel | undefined {
    const provider = getProvider(providerId);
    return provider?.models.find(m => m.id === modelId);
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(providerId: AIProvider): AIModel | undefined {
    const provider = getProvider(providerId);
    return provider?.models[0];
}
