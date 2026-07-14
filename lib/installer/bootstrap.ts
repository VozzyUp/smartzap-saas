/**
 * Bootstrap da instância SmartZap.
 * Configura settings iniciais após migrations.
 *
 * NOTA (Task 10 — cutover de auth): `MASTER_PASSWORD` foi aposentado como
 * login de usuário do dashboard (isso agora é Supabase Auth por senha —
 * ver `lib/user-auth.ts` e `proxy.ts`). O único uso restante de
 * MASTER_PASSWORD no produto é aqui: como gate/senha inicial do wizard de
 * instalação (`/install`, `app/api/installer/*`), que roda ANTES de existir
 * qualquer usuário Supabase (chicken-and-egg do bootstrap de infra). Não
 * remova esse uso.
 */

import { createClient } from '@supabase/supabase-js';
import { generateKeyPair } from '@/lib/whatsapp/flow-endpoint-crypto';

type BootstrapInput = {
  supabaseUrl: string;
  serviceRoleKey: string;
  adminEmail: string;
  adminName?: string;
};

type BootstrapResult =
  | { ok: false; error: string }
  | { ok: true; mode: 'created' | 'exists' };

/**
 * Verifica se a conexão com o Supabase funciona (para validar instalação).
 * Não verifica login de usuário — isso é Supabase Auth (senha), fora
 * do escopo do installer. Esta função apenas verifica conectividade.
 */
export async function verifySupabaseConnection(params: {
  supabaseUrl: string;
  anonKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = createClient(params.supabaseUrl, params.anonKey);

    // Tenta fazer uma query simples para verificar conectividade
    const { error } = await client.from('settings').select('key').limit(1);

    if (error) {
      // Se tabela não existe, pode ser que migrations ainda não rodaram
      if (error.code === '42P01') {
        return { ok: false, error: 'Tabela settings não encontrada. Execute as migrations primeiro.' };
      }
      // RLS pode bloquear acesso - isso é esperado
      if (error.code === '42501' || error.message?.includes('permission denied')) {
        return { ok: true }; // Conectividade OK, RLS está funcionando
      }
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao verificar conexão' };
  }
}

/**
 * Bootstrap da instância SmartZap.
 * Idempotente - pode rodar múltiplas vezes sem efeitos colaterais.
 */
export async function bootstrapInstance({
  supabaseUrl,
  serviceRoleKey,
  adminEmail,
  adminName,
}: BootstrapInput): Promise<BootstrapResult> {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const emailNorm = adminEmail.trim().toLowerCase();

  // 1) Verifica se já existe configuração de admin_email
  const { data: existingEmail, error: checkError } = await admin
    .from('settings')
    .select('value')
    .eq('key', 'admin_email')
    .single();

  if (checkError && checkError.code !== 'PGRST116') {
    // PGRST116 = não encontrado - ok
    return { ok: false, error: checkError.message };
  }

  // Se já existe admin_email configurado, não sobrescreve
  if (existingEmail?.value) {
    console.log('[bootstrap] admin_email já configurado, mantendo existente');
    return { ok: true, mode: 'exists' };
  }

  // 2) Configura settings iniciais
  // Nota: company_name é necessário para isSetupComplete() retornar true
  // Usa o nome do admin se fornecido, senão extrai do email como fallback
  const companyName = adminName?.trim() || emailNorm.split('@')[0] || 'SmartZap';

  // Gera chaves RSA para o Flow Endpoint (MiniApp Dinâmico)
  // Isso evita erro ao publicar Flows que usam endpoint dinâmico
  const flowKeys = generateKeyPair();

  const initialSettings = [
    { key: 'admin_email', value: emailNorm },
    { key: 'admin_name', value: adminName?.trim() || '' },
    { key: 'company_name', value: companyName },
    { key: 'installation_date', value: new Date().toISOString() },
    { key: 'version', value: '1.0.0' },
    // Flow Endpoint keys - geradas automaticamente para evitar erros de publicação
    { key: 'whatsapp_flow_private_key', value: flowKeys.privateKey },
    { key: 'whatsapp_flow_public_key', value: flowKeys.publicKey },
  ];

  for (const setting of initialSettings) {
    const { error: upsertError } = await admin
      .from('settings')
      .upsert(
        { key: setting.key, value: setting.value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (upsertError) {
      console.error(`[bootstrap] Erro ao configurar ${setting.key}:`, upsertError.message);
      // Continua tentando outras configurações
    }
  }

  console.log('[bootstrap] Configurações iniciais aplicadas');
  return { ok: true, mode: 'created' };
}

/**
 * Verifica se a instância já foi bootstrapped.
 */
export async function isBootstrapped(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
}): Promise<boolean> {
  try {
    const admin = createClient(params.supabaseUrl, params.serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data } = await admin
      .from('settings')
      .select('value')
      .eq('key', 'installation_date')
      .single();

    return Boolean(data?.value);
  } catch {
    return false;
  }
}
