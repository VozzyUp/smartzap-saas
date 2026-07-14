import { getSupabaseAdmin } from '@/lib/supabase'

/**
 * Resolve o tenant de um atendente a partir do seu attendant_token.
 * Ponto de entrada sem sessão de usuário (o atendente acessa /atendimento
 * com ?token=). Usa o admin client porque não há sessão para a RLS avaliar;
 * o isolamento vem da própria validação do token.
 */
export async function resolveTenantByAttendantToken(token: string | null): Promise<string | null> {
  if (!token) return null
  const db = getSupabaseAdmin()
  if (!db) return null

  const { data } = await db
    .from('attendant_tokens')
    .select('tenant_id, is_active, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null
  return data.tenant_id ?? null
}
