// scripts/seed-platform-admin.ts
// Promove um usuário Supabase existente (por email) a platform_admin.
// Uso: npx tsx scripts/seed-platform-admin.ts --email=admin@exemplo.com
//
// Requer service role key no ambiente (uma das duas):
//   SUPABASE_SECRET_KEY (canônica neste projeto)
//   SUPABASE_SERVICE_ROLE_KEY (compat)
// e NEXT_PUBLIC_SUPABASE_URL.
//
// Idempotente: faz upsert em public.platform_admins(user_id), não insert puro.
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

const PAGE_SIZE = 1000

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : undefined
}

function getSupabaseServiceRoleKey(): string | undefined {
  // Canonical neste projeto: SUPABASE_SECRET_KEY
  // Compat: muitos setups usam SUPABASE_SERVICE_ROLE_KEY
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
}

async function findUserByEmail(client: SupabaseClient, email: string) {
  const target = email.trim().toLowerCase()
  let page = 1
  // supabase-js v2 não expõe filtro por email em auth.admin.listUsers();
  // paginamos até encontrar (ou esgotar as páginas).
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    })
    if (error) {
      throw new Error(`Falha ao listar usuários (page=${page}): ${error.message}`)
    }
    const users = data?.users ?? []
    const match = users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match

    if (users.length < PAGE_SIZE) {
      // última página, não encontrou
      return null
    }
    page += 1
  }
}

async function main() {
  const email = getArg('email')
  if (!email) {
    console.error('Uso: npx tsx scripts/seed-platform-admin.ts --email=admin@exemplo.com')
    process.exit(2)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = getSupabaseServiceRoleKey()

  if (!url || !serviceKey) {
    console.error(
      '[seed-platform-admin] Faltam variáveis de ambiente: NEXT_PUBLIC_SUPABASE_URL e ' +
        'SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY).'
    )
    process.exit(1)
  }

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`[seed-platform-admin] Buscando usuário por email: ${email}`)
  const user = await findUserByEmail(client, email)

  if (!user) {
    console.error(
      `[seed-platform-admin] ERRO: nenhum usuário encontrado em auth.users com email "${email}". ` +
        'Crie o usuário (ex.: via signup ou Supabase Dashboard) antes de rodar este script.'
    )
    process.exit(1)
  }

  console.log(`[seed-platform-admin] Usuário encontrado: user_id=${user.id}`)

  const { error: upsertError } = await client
    .from('platform_admins')
    .upsert({ user_id: user.id }, { onConflict: 'user_id' })

  if (upsertError) {
    console.error(`[seed-platform-admin] ERRO ao fazer upsert em platform_admins: ${upsertError.message}`)
    process.exit(1)
  }

  console.log(`[seed-platform-admin] OK — ${email} (user_id=${user.id}) promovido a platform_admin.`)
}

main().catch((e) => {
  console.error('[seed-platform-admin] ERRO inesperado:', e)
  process.exit(1)
})
