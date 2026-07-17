/**
 * Cliente HTTP centralizado para API routes do Next.js.
 *
 * Elimina o boilerplate de fetch + verificação de response.ok + extração
 * de erro do payload que estava duplicado em todos os services.
 *
 * Uso:
 *   import { api } from '@/lib/api'
 *   const data = await api.get<Campaign[]>('/api/campaigns')
 *   await api.post('/api/campaigns', { name: 'X' })
 *   await api.patch(`/api/campaigns/${id}`, { status: 'PAUSED' })
 *   await api.del(`/api/campaigns/${id}`)
 */

/**
 * Erro de resposta HTTP não-ok. Preserva `status` e o `body` (JSON) da resposta
 * para que callers possam inspecionar erros estruturados (ex.: { error: 'plan_limit', ... })
 * sem perder a compatibilidade com o uso comum de `error.message`.
 */
export class ApiError extends Error {
    status: number;
    body: unknown;

    constructor(message: string, status: number, body: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

/** Extrai o body JSON da resposta (ou null se não for parseável). */
async function extractErrorBody(response: Response): Promise<any> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/** Lança ApiError com mensagem, status e body extraídos da resposta. */
async function throwApiError(response: Response): Promise<never> {
    const body = await extractErrorBody(response);
    const message = body?.error || body?.message || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, body);
}

export const api = {
    /** GET — lança ApiError se a resposta não for ok. */
    async get<T>(path: string, init?: RequestInit): Promise<T> {
        const response = init !== undefined ? await fetch(path, init) : await fetch(path);
        if (!response.ok) await throwApiError(response);
        return response.json();
    },

    /**
     * GET seguro — retorna `fallback` em vez de lançar erro.
     * Use para listas onde a UI deve mostrar vazio ao invés de crashar.
     */
    async safeGet<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
        try {
            const response = init !== undefined ? await fetch(path, init) : await fetch(path);
            if (!response.ok) return fallback;
            return response.json();
        } catch {
            return fallback;
        }
    },

    /** POST com corpo JSON — lança ApiError com mensagem do servidor. Retorna null em 204. */
    async post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            ...init,
        });
        if (!response.ok) await throwApiError(response);
        if (response.status === 204 || response.headers.get('content-length') === '0') return null as T;
        return response.json();
    },

    /** PATCH com corpo JSON — lança ApiError com mensagem do servidor. Retorna null em 204. */
    async patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
        const response = await fetch(path, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            ...init,
        });
        if (!response.ok) await throwApiError(response);
        if (response.status === 204 || response.headers.get('content-length') === '0') return null as T;
        return response.json();
    },

    /** DELETE — lança ApiError com mensagem do servidor. Sem corpo de retorno. */
    async del(path: string, init?: RequestInit): Promise<void> {
        const response = await fetch(path, { method: 'DELETE', ...init });
        if (!response.ok) await throwApiError(response);
    },
};
