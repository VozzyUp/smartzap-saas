import { getSupabaseAdmin } from '@/lib/supabase'

/**
 * platformSettingsDb — configurações globais de plataforma (não por tenant).
 *
 * Diferente de `settingsDb` (lib/supabase-db.ts), que é per-tenant, este
 * helper lê/escreve em `public.platform_settings` (chave global, RLS
 * "admin only"). Usa sempre o client service_role (getSupabaseAdmin),
 * então bypassa RLS — não deve ser exposto diretamente a requests de
 * usuário sem checagem de admin.
 */
export const platformSettingsDb = {
    get: async <T = unknown>(key: string): Promise<T | null> => {
        const client = getSupabaseAdmin()
        if (!client) throw new Error('Supabase not configured. Complete setup at /install')

        const { data, error } = await client
            .from('platform_settings')
            .select('value')
            .eq('key', key)
            .maybeSingle()

        if (error || !data) return null

        return data.value as T
    },

    set: async (key: string, value: unknown): Promise<void> => {
        const client = getSupabaseAdmin()
        if (!client) throw new Error('Supabase not configured. Complete setup at /install')

        const { error } = await client
            .from('platform_settings')
            .upsert({
                key,
                value,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'key' })

        if (error) throw error
    },

    delete: async (key: string): Promise<void> => {
        const client = getSupabaseAdmin()
        if (!client) throw new Error('Supabase not configured. Complete setup at /install')

        const { error } = await client
            .from('platform_settings')
            .delete()
            .eq('key', key)

        if (error) throw error
    },
}
