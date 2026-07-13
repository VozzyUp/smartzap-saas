import { platformSettingsDb } from '@/lib/platform-settings'

interface VerifyTokenOptions {
    readonly?: boolean
}

let inMemoryToken: string | null = null

/**
 * Get or generate the platform-level webhook verify token.
 *
 * Configuração de plataforma, não por tenant: o endpoint /api/webhook é uma
 * única URL compartilhada por todos os tenants, e o hub.verify_token do Meta
 * é validado uma vez na configuração do App (não carrega identidade de tenant).
 *
 * @param options.readonly Se true, não gera um novo token se ausente (evita race conditions).
 */
export async function getVerifyToken(options: VerifyTokenOptions = {}): Promise<string> {
    const { readonly = false } = options

    try {
        // 1. Try Supabase platform_settings (Primary - "Source of Truth")
        console.log('🔍 getVerifyToken: Checking DB...')
        const storedToken = await platformSettingsDb.get<string>('webhook_verify_token')
        if (storedToken) {
            console.log('✅ getVerifyToken: Found in DB:', storedToken)
            return storedToken
        }

        // 2. Try Environment Variable (Fallback)
        if (process.env.WEBHOOK_VERIFY_TOKEN) {
            console.log('ℹ️ getVerifyToken: Using ENV fallback')
            return process.env.WEBHOOK_VERIFY_TOKEN.trim()
        }

        // 3. If Read-Only, stop here (use in-memory if available)
        if (readonly) {
            if (inMemoryToken) {
                console.log('ℹ️ getVerifyToken: Using in-memory fallback (readonly)')
                return inMemoryToken
            }
            console.warn('⚠️ getVerifyToken: Token missing and Read-Only. Failing.')
            return 'token-not-found-readonly'
        }

        // 4. Generate New Token (fallback to memory if DB unavailable)
        const newToken = crypto.randomUUID()
        inMemoryToken = newToken
        console.log('🔑 getVerifyToken: Generating new:', newToken)
        try {
            await platformSettingsDb.set('webhook_verify_token', newToken)
        } catch (err) {
            console.warn('⚠️ getVerifyToken: Failed to persist token, using in-memory fallback.')
        }

        // Safety: Verify it was written (Consistency check)
        const check = await platformSettingsDb.get<string>('webhook_verify_token')
        if (check !== newToken) {
            console.error('💥 getVerifyToken: Write failed consistency check!')
        }

        return newToken

    } catch (err) {
        console.error('💥 getVerifyToken Error:', err)
        if (inMemoryToken) return inMemoryToken
        return process.env.WEBHOOK_VERIFY_TOKEN?.trim() || 'error-retrieving-token'
    }
}
