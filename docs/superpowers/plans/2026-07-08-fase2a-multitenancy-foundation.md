# Fase 2A — Fundação Multi-tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o SmartZap de single-tenant em multi-tenant: identidade via Supabase Auth (magic link, sessão única), tabelas `tenants`/`tenant_members`/`platform_admins`, `tenant_id` + RLS em todas as 38 tabelas de domínio, escopo por tenant centralizado na camada de dados, `MASTER_PASSWORD` aposentado da auth de usuário.

**Architecture:** Isolamento **híbrido** — RLS real (DB-enforced) em todas as tabelas para proteger os caminhos com contexto de usuário (incl. Realtime do browser); rotas API continuam em `service_role` mas o filtro `tenant_id` fica centralizado na camada de dados (`lib/supabase-db.ts` e afins). Sessão única via `@supabase/ssr`. Superadmin via papel `platform_admins`.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + Auth + Realtime + `@supabase/ssr`), TypeScript, Vitest.

## Global Constraints

- Cada request de usuário tem exatamente **uma** identidade: `auth.uid()` do Supabase. Sem sessão-cookie legada.
- Cada tabela de domínio (as 38 listadas na Estrutura de arquivos) tem `tenant_id uuid NOT NULL references tenants(id) on delete cascade`, com índice.
- Toda função pública (RPC) que hoje é `GRANT ... TO service_role` continua rodando como service_role, mas deve receber ou derivar `tenant_id` do argumento/linha.
- **SaaS net-new**: dados de dev do banco atual serão limpos (TRUNCATE das tabelas de domínio) **antes** da migração de multi-tenancy. Nenhum backfill.
- `MASTER_PASSWORD` só permanece como gate do wizard `/install` (setup de infra do operador). Removido de `lib/user-auth.ts`, `app/api/auth/*`, e do proxy como caminho de login.
- Auth = **magic link** (Supabase Email OTP). Cookie de sessão gerenciado por `@supabase/ssr`.
- Testes: Vitest com `globals:true`, alias `@`. Comandos: `npm run test`, `npm run build`, `npm run lint`. Suite atual = 3412 testes; alvo = 3412 + novos, nenhuma regressão.
- Branch: `saas/fase-2-multitenancy`. Commits pequenos, um por passo de commit.
- Spec: `docs/superpowers/specs/2026-07-08-fase2a-multitenancy-foundation-design.md`.
- **Regras Supabase (obrigatórias em todas as tasks SQL):**
  - Toda `SECURITY DEFINER` function em `public` deve terminar com `revoke execute on function public.X from public; grant execute on function public.X to authenticated, service_role;` — sem isso, o Postgres concede EXECUTE ao role `PUBLIC` (calável por `anon`).
  - Toda policy RLS usa `to authenticated` (ou o role específico) — nunca omitir. `auth.role()` está deprecado.
  - Policies `for update` levam `USING` **e** `WITH CHECK` idênticos (previne re-atribuição de `tenant_id`).
  - **Aplicação de SQL via Supabase MCP:** durante o desenvolvimento/iteração use **`mcp__supabase__execute_sql`** (não deixa entrada no histórico de migrações). Só quando o SQL final estiver validado, salvar o arquivo em `supabase/migrations/` (criado no repo) — e opcionalmente reproduzir via `mcp__supabase__apply_migration` para gravar histórico. Motivo: `apply_migration` grava histórico a cada chamada, impedindo iteração limpa (`supabase db diff`/`pull` param de funcionar bem).
  - **NÃO existem** neste repo os scripts `apply-migration-pg.mjs` e `schema-parity-check.ts` (referenciados no CLAUDE.md do produto original). Substituir por chamadas MCP.
  - **Verificação obrigatória após aplicar SQL:** `mcp__supabase__get_advisors` (security + performance) — corrigir qualquer finding antes de commitar a migração.
  - **Criação de arquivos de migração:** usar `supabase migration new <nome>` (CLI) quando disponível, ou nomear no padrão `YYYYMMDDHHMMSS_<slug>.sql`. Nunca inventar nome.

---

## Estrutura de arquivos

**Novas migrações SQL** (`supabase/migrations/`):
- `20260709000001_multitenancy_platform_tables.sql` — cria `tenants`, `tenant_members`, `platform_admins`, `platform_settings`, funções `current_tenant_id()`, `is_platform_admin(uuid)`.
- `20260709000002_multitenancy_add_tenant_id.sql` — TRUNCATE + `ALTER TABLE ... ADD COLUMN tenant_id NOT NULL` + índices nas 38 tabelas de domínio; converte `settings` para PK `(tenant_id, key)`; extrai chaves de plataforma para `platform_settings`.
- `20260709000003_multitenancy_rls_policies.sql` — habilita RLS com policies reais em todas as tabelas de tenant.

**Novos arquivos TypeScript:**
- `lib/tenant-context.ts` — `getTenantContext(request | headers)`, `getTenantContextSC()` (server component), tipagem `TenantContext`.
- `lib/tenant-context.test.ts`.
- `lib/supabase-auth.ts` — helpers para login/logout/status via magic link (server actions).
- `lib/tenant-provisioning.ts` — cria `tenant + tenant_members(owner)` no 1º login (idempotente).
- `lib/tenant-provisioning.test.ts`.
- `lib/platform-settings.ts` — CRUD de `platform_settings` (substitui os call-sites de settings globais).
- `app/api/auth/magic-link/route.ts` — recebe email → dispara magic link Supabase.
- `app/api/auth/callback/route.ts` — troca code por sessão + provisiona tenant se 1º login.
- `app/(auth)/login/page.tsx` — refatorada: só magic-link (remove campo senha).
- `scripts/seed-platform-admin.ts` — cria/promove um usuário Supabase a `platform_admin`.
- `scripts/purge-dev-data.ts` — TRUNCATE das tabelas de domínio (limpeza pré-migração, com confirmação).
- `tests/integration/tenant-isolation.test.ts` — cria 2 tenants, insere dados, verifica que um não enxerga o outro (via camada de dados **e** via client de browser com RLS).

**Modificar:**
- `lib/supabase-db.ts` — refatorar 10 objetos `*Db` (campaignDb, contactDb, leadFormDb, campaignContactDb, templateDb, customFieldDefDb, settingsDb, dashboardDb, templateProjectDb, campaignFolderDb) para receber `tenantId` e escopar todas as queries.
- `lib/user-auth.ts` — remover fluxo `MASTER_PASSWORD` de login; deprecar arquivo (mantém stub se preciso) ou remover.
- `lib/auth.ts` — auth de API por header segue igual; adicionar caminho de sessão Supabase para user cookies.
- `proxy.ts` — trocar checagem de `smartzap_session` cookie por sessão Supabase (`@supabase/ssr`); resolver tenant do request.
- `app/api/auth/status/route.ts` — reporta login-status via Supabase, não `MASTER_PASSWORD`.
- `app/api/auth/setup/route.ts` + `app/api/[transport]/route.ts` — remover paths de MASTER_PASSWORD.
- Todos os call-sites de `settingsDb.get/set` (~121) — trocar por versão tenant-scoped OU `platformSettings` conforme a chave. Um script no plano ajuda a mapear.
- `lib/whatsapp-credentials.ts` — passa a resolver credenciais do tenant do request (adia decisão de "credenciais primárias por tenant" para Fase 3; no 2A o mapa é `settings` per-tenant).

**Preservar (para o install pré-Supabase do operador):**
- `MASTER_PASSWORD` como gate em `app/api/installer/*` e `lib/installer/bootstrap.ts`. Adicionar comentário claro que este é o único uso remanescente.

---

### Task 1: Migração SQL — Plataforma (tenants + funções auxiliares)

**Files:**
- Create: `supabase/migrations/20260709000001_multitenancy_platform_tables.sql`
- Create: `supabase/migrations/20260709000001_multitenancy_platform_tables.rollback.sql` (para dev; documentado no plano)

**Interfaces:**
- Consumes: nada.
- Produces: tabelas `public.tenants`, `public.tenant_members`, `public.platform_admins`, `public.platform_settings`; funções `public.current_tenant_id() returns uuid`, `public.is_platform_admin(uid uuid) returns boolean`. Ambas as funções são `SECURITY DEFINER` + `STABLE`.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260709000001_multitenancy_platform_tables.sql
begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  status text not null default 'trialing' check (status in ('trialing','active','suspended')),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists idx_tenant_members_user_id on public.tenant_members(user_id);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Funções auxiliares (SECURITY DEFINER para poderem ler tenant_members sob RLS)
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_platform_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.platform_admins where user_id = uid);
$$;

-- Fecha o EXECUTE default para PUBLIC (evita callable por anon) e concede só aos roles pretendidos
revoke execute on function public.current_tenant_id() from public;
revoke execute on function public.is_platform_admin(uuid) from public;
grant execute on function public.current_tenant_id() to authenticated, service_role;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

-- RLS das próprias tabelas de plataforma
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;

-- Um usuário vê seu tenant; platform_admin vê tudo. TO authenticated é obrigatório.
create policy "tenant_members self read" on public.tenant_members
  for select to authenticated
  using ( user_id = (select auth.uid()) or public.is_platform_admin((select auth.uid())) );

create policy "tenants self read" on public.tenants
  for select to authenticated
  using ( id = public.current_tenant_id() or public.is_platform_admin((select auth.uid())) );

-- platform_admins e platform_settings: só platform_admin lê/escreve; service_role bypassa
create policy "platform_admins self read" on public.platform_admins
  for select to authenticated
  using ( user_id = (select auth.uid()) or public.is_platform_admin((select auth.uid())) );

create policy "platform_settings admin only" on public.platform_settings
  for all to authenticated
  using ( public.is_platform_admin((select auth.uid())) )
  with check ( public.is_platform_admin((select auth.uid())) );

commit;
```

- [ ] **Step 2: Aplicar contra o banco de dev**

Run: `node scripts/apply-migration-pg.mjs supabase/migrations/20260709000001_multitenancy_platform_tables.sql`
Expected: sem erro; `psql \d tenants` mostra a tabela.

- [ ] **Step 3: Baseline / paridade de schema**

Run: `npm run schema:parity`
Expected: verde (ou o diff esperado das 4 tabelas + 2 funções novas — o script imprime o diff).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260709000001_multitenancy_platform_tables.sql
git commit -m "feat(multitenancy): tabelas de plataforma + funções current_tenant_id/is_platform_admin"
```

---

### Task 2: Limpeza de dados de dev (script + execução)

**Files:**
- Create: `scripts/purge-dev-data.ts`

**Interfaces:**
- Consumes: conexão pg via `DATABASE_URL` de dev.
- Produces: banco de dev com as 38 tabelas de domínio vazias; tabelas de plataforma preservadas; migrações preservadas.

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/purge-dev-data.ts
import { Client } from 'pg'
import 'dotenv/config'

const DOMAIN_TABLES = [
  'account_alerts','ai_agent_logs','ai_agents','ai_embeddings','ai_knowledge_files',
  'attendant_tokens','campaign_batch_metrics','campaign_contacts','campaign_folders',
  'campaign_run_metrics','campaign_tag_assignments','campaign_tags','campaign_trace_events',
  'campaigns','contacts','custom_field_definitions','flow_submissions','flows',
  'inbox_conversation_labels','inbox_conversations','inbox_labels','inbox_messages',
  'inbox_quick_replies','lead_forms','phone_suppressions','push_subscriptions','settings',
  'template_project_items','template_projects','templates','whatsapp_status_events',
  'workflow_builder_executions','workflow_builder_logs','workflow_conversations',
  'workflow_run_logs','workflow_runs','workflow_versions','workflows',
]

const args = new Set(process.argv.slice(2))
if (!args.has('--yes-really-purge')) {
  console.error('Refusing to run without --yes-really-purge. This TRUNCATEs 38 tables.')
  process.exit(2)
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const sql = `truncate ${DOMAIN_TABLES.map(t => `public."${t}"`).join(', ')} restart identity cascade;`
  console.log('Running:', sql)
  await client.query(sql)
  console.log('OK — 38 tabelas de domínio truncadas.')
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Executar contra dev**

Run: `npx tsx scripts/purge-dev-data.ts --yes-really-purge`
Expected: `OK — 38 tabelas de domínio truncadas.`

- [ ] **Step 3: Commit**

```bash
git add scripts/purge-dev-data.ts
git commit -m "chore(2A): script de limpeza de dados de dev (pré-migração multi-tenant)"
```

---

### Task 3: Migração SQL — `tenant_id` nas 38 tabelas de domínio + `settings` per-tenant

**Files:**
- Create: `supabase/migrations/20260709000002_multitenancy_add_tenant_id.sql`

**Interfaces:**
- Consumes: tabelas da Task 1 (tenants existe).
- Produces: todas as 38 tabelas com coluna `tenant_id uuid NOT NULL references tenants(id)` + índice; `settings` com PK `(tenant_id, key)`; chaves de plataforma (`session_tokens`, config Vercel-ops etc.) migradas para `platform_settings` (aqui: script vazio já que tabelas foram truncadas, mas a estrutura fica pronta).

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260709000002_multitenancy_add_tenant_id.sql
begin;

-- Todas as tabelas de domínio recebem tenant_id NOT NULL + índice.
-- Ordem: adicionar coluna → índice. Sem backfill (dados truncados na task anterior).
do $$
declare
  t text;
  tables text[] := array[
    'account_alerts','ai_agent_logs','ai_agents','ai_embeddings','ai_knowledge_files',
    'attendant_tokens','campaign_batch_metrics','campaign_contacts','campaign_folders',
    'campaign_run_metrics','campaign_tag_assignments','campaign_tags','campaign_trace_events',
    'campaigns','contacts','custom_field_definitions','flow_submissions','flows',
    'inbox_conversation_labels','inbox_conversations','inbox_labels','inbox_messages',
    'inbox_quick_replies','lead_forms','phone_suppressions','push_subscriptions',
    'template_project_items','template_projects','templates','whatsapp_status_events',
    'workflow_builder_executions','workflow_builder_logs','workflow_conversations',
    'workflow_run_logs','workflow_runs','workflow_versions','workflows'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column tenant_id uuid not null references public.tenants(id) on delete cascade',
      t
    );
    execute format(
      'create index if not exists %I on public.%I(tenant_id)',
      'idx_' || t || '_tenant_id', t
    );
  end loop;
end$$;

-- settings: novo PK (tenant_id, key)
alter table public.settings drop constraint if exists settings_pkey;
alter table public.settings add column tenant_id uuid not null references public.tenants(id) on delete cascade;
alter table public.settings add primary key (tenant_id, key);
create index if not exists idx_settings_tenant_id on public.settings(tenant_id);

commit;
```

- [ ] **Step 2: Aplicar + verificar**

Run: `node scripts/apply-migration-pg.mjs supabase/migrations/20260709000002_multitenancy_add_tenant_id.sql`
Then: `psql -c "\d contacts"` (deve mostrar `tenant_id` NOT NULL); `psql -c "\d settings"` (PK composta).
Expected: sem erro; colunas/índices presentes.

- [ ] **Step 3: `npm run build` sanity**

Run: `npm run build`
Expected: build ainda passa (o app ainda não usa `tenant_id`; a leitura/escrita continua funcionando enquanto o banco só rejeita inserts NULL, o que só aconteceria em testes; ver Task 6 para ajuste do data layer).

Se o build falhar por causa de queries com selects estritos, sinalizar concern e proceder — a Task 6 conserta os call-sites.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260709000002_multitenancy_add_tenant_id.sql
git commit -m "feat(multitenancy): tenant_id NOT NULL + índices nas 38 tabelas de domínio; settings PK (tenant_id, key)"
```

---

### Task 4: Migração SQL — RLS policies em todas as tabelas de tenant

**Files:**
- Create: `supabase/migrations/20260709000003_multitenancy_rls_policies.sql`

**Interfaces:**
- Consumes: `current_tenant_id()`, `is_platform_admin()`, colunas `tenant_id` das Tasks 1–3.
- Produces: policies uniformes de leitura+escrita nas 38 tabelas.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260709000003_multitenancy_rls_policies.sql
begin;

do $$
declare
  t text;
  tables text[] := array[
    'account_alerts','ai_agent_logs','ai_agents','ai_embeddings','ai_knowledge_files',
    'attendant_tokens','campaign_batch_metrics','campaign_contacts','campaign_folders',
    'campaign_run_metrics','campaign_tag_assignments','campaign_tags','campaign_trace_events',
    'campaigns','contacts','custom_field_definitions','flow_submissions','flows',
    'inbox_conversation_labels','inbox_conversations','inbox_labels','inbox_messages',
    'inbox_quick_replies','lead_forms','phone_suppressions','push_subscriptions','settings',
    'template_project_items','template_projects','templates','whatsapp_status_events',
    'workflow_builder_executions','workflow_builder_logs','workflow_conversations',
    'workflow_run_logs','workflow_runs','workflow_versions','workflows'
  ];
begin
  foreach t in array tables loop
    -- Drop policies pré-existentes com o mesmo nome (idempotência)
    execute format('drop policy if exists "tenant_isolation_%s" on public.%I', t, t);
    execute format($f$
      create policy "tenant_isolation_%1$s" on public.%1$I
      as permissive
      for all
      to authenticated
      using ( tenant_id = public.current_tenant_id() or public.is_platform_admin((select auth.uid())) )
      with check ( tenant_id = public.current_tenant_id() or public.is_platform_admin((select auth.uid())) );
    $f$, t);
  end loop;
end$$;

commit;
```

- [ ] **Step 2: Aplicar + smoke via psql**

Run: `node scripts/apply-migration-pg.mjs supabase/migrations/20260709000003_multitenancy_rls_policies.sql`
Then, com o role service_role: `insert into contacts(tenant_id, ...)` funciona (service bypassa). Com um role `authenticated` sem `tenant_members`: `select * from contacts` retorna 0 linhas (RLS bloqueia). Documentar as duas rodadas no relatório.
Expected: sem erro na migração.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260709000003_multitenancy_rls_policies.sql
git commit -m "feat(multitenancy): RLS por tenant em todas as 38 tabelas (com bypass de platform_admin)"
```

---

### Task 5: Contexto de tenant + provisionamento no 1º login (TDD)

**Files:**
- Create: `lib/tenant-context.ts`, `lib/tenant-context.test.ts`
- Create: `lib/tenant-provisioning.ts`, `lib/tenant-provisioning.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin`, `createClient` (server) de `lib/supabase*`; `current_tenant_id()`, tabelas `tenants`/`tenant_members`.
- Produces:
  - `getTenantContext(req: NextRequest | Request): Promise<TenantContext>` — retorna `{ tenantId, userId, isPlatformAdmin }` a partir da sessão Supabase, ou `null` (sessão ausente).
  - `provisionTenantForUser(userId: string, emailForName: string): Promise<{ tenantId: string; created: boolean }>` — idempotente.
- Tipo: `type TenantContext = { tenantId: string | null; userId: string; isPlatformAdmin: boolean }`.

- [ ] **Step 1: Escrever teste falhando de `provisionTenantForUser`**

```typescript
// lib/tenant-provisioning.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertTenant = vi.fn()
const insertMember = vi.fn()
const selectMember = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: selectMember }) }),
      insert: (row: any) => t === 'tenants' ? insertTenant(row) : insertMember(row),
    }),
  }),
}))

import { provisionTenantForUser } from '@/lib/tenant-provisioning'

describe('provisionTenantForUser', () => {
  beforeEach(() => {
    insertTenant.mockReset(); insertMember.mockReset(); selectMember.mockReset()
  })

  it('retorna o tenant existente se o usuário já é membro', async () => {
    selectMember.mockResolvedValueOnce({ data: { tenant_id: 't1' }, error: null })
    const r = await provisionTenantForUser('u1', 'a@b.com')
    expect(r).toEqual({ tenantId: 't1', created: false })
    expect(insertTenant).not.toHaveBeenCalled()
  })

  it('cria tenant e membership no 1º login', async () => {
    selectMember.mockResolvedValueOnce({ data: null, error: null })
    insertTenant.mockResolvedValueOnce({ data: [{ id: 'new-t' }], error: null })
    insertMember.mockResolvedValueOnce({ data: null, error: null })
    const r = await provisionTenantForUser('u1', 'ana@empresa.com')
    expect(r.created).toBe(true)
    expect(r.tenantId).toBe('new-t')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/tenant-provisioning.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
// lib/tenant-provisioning.ts
import { getSupabaseAdmin } from '@/lib/supabase'

function slugFromEmail(email: string) {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'tenant'
  return `${local}-${Math.random().toString(36).slice(2, 7)}`
}

export async function provisionTenantForUser(
  userId: string, emailForName: string,
): Promise<{ tenantId: string; created: boolean }> {
  const db = getSupabaseAdmin()!
  const existing = await db.from('tenant_members')
    .select('tenant_id').eq('user_id', userId).maybeSingle()
  if (existing.data?.tenant_id) {
    return { tenantId: existing.data.tenant_id, created: false }
  }
  const inserted = await db.from('tenants').insert({
    name: emailForName, slug: slugFromEmail(emailForName), status: 'trialing',
  })
  const tenantId = (inserted as any).data?.[0]?.id
  await db.from('tenant_members').insert({ tenant_id: tenantId, user_id: userId, role: 'owner' })
  return { tenantId, created: true }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/tenant-provisioning.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever teste falhando de `getTenantContext`**

```typescript
// lib/tenant-context.test.ts
import { describe, it, expect, vi } from 'vitest'
const rpcCurrent = vi.fn()
const rpcAdmin = vi.fn()
const getUser = vi.fn()
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser },
    rpc: (name: string) =>
      name === 'current_tenant_id' ? rpcCurrent() :
      name === 'is_platform_admin' ? rpcAdmin() : Promise.reject(new Error('unknown rpc')),
  }),
}))

import { getTenantContext } from '@/lib/tenant-context'

describe('getTenantContext', () => {
  it('retorna null quando não há usuário', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect(await getTenantContext()).toBeNull()
  })
  it('retorna tenantId e flags quando há sessão', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null })
    rpcCurrent.mockResolvedValueOnce({ data: 't1', error: null })
    rpcAdmin.mockResolvedValueOnce({ data: false, error: null })
    const ctx = await getTenantContext()
    expect(ctx).toEqual({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false })
  })
})
```

- [ ] **Step 6: Rodar e ver falhar** → Run: `npx vitest run lib/tenant-context.test.ts` (FAIL).

- [ ] **Step 7: Implementar**

```typescript
// lib/tenant-context.ts
import { createClient } from '@/lib/supabase-server'

export type TenantContext = {
  tenantId: string | null
  userId: string
  isPlatformAdmin: boolean
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return null
  const [{ data: tenantId }, { data: isAdmin }] = await Promise.all([
    supa.rpc('current_tenant_id'),
    supa.rpc('is_platform_admin'),
  ])
  return { tenantId: (tenantId as string) ?? null, userId: user.id, isPlatformAdmin: !!isAdmin }
}
```

- [ ] **Step 8: Rodar tudo passar**

Run: `npx vitest run lib/tenant-context.test.ts lib/tenant-provisioning.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/tenant-context.ts lib/tenant-context.test.ts lib/tenant-provisioning.ts lib/tenant-provisioning.test.ts
git commit -m "feat(multitenancy): getTenantContext() + provisionTenantForUser() com testes"
```

---

### Task 6: Camada de dados — receber `tenantId` e escopar todas as queries

**Files:** Modify `lib/supabase-db.ts` — os 10 objetos `*Db`: campaignDb, contactDb, leadFormDb, campaignContactDb, templateDb, customFieldDefDb, settingsDb, dashboardDb, templateProjectDb, campaignFolderDb.

**Interfaces:**
- Consumes: `TenantContext` da Task 5.
- Produces: cada método `*Db.xxx()` passa a receber `tenantId: string` como primeiro argumento (ou objeto de opções `{ tenantId }`) e aplica `.eq('tenant_id', tenantId)` em selects e `tenant_id` em inserts. `settingsDb` fica per-tenant; a antiga interface global vira `platformSettingsDb` (Task 7).

- [ ] **Step 1: Refatorar cada `*Db`, um por vez**

Para cada objeto: (a) prefixar todos os métodos com `tenantId: string`; (b) em selects, `.eq('tenant_id', tenantId)`; (c) em inserts, `.insert({ ..., tenant_id: tenantId })`; (d) em updates/deletes, incluir `.eq('tenant_id', tenantId)` no filtro. Compilar após cada `*Db`.

Padrão para `contactDb.getAll()` (exemplo — replicar para os outros):

```typescript
// ANTES
async getAll() {
  const supa = getSupabaseAdmin()!
  return supa.from('contacts').select('*').order('created_at', { ascending: false })
}
// DEPOIS
async getAll(tenantId: string) {
  const supa = getSupabaseAdmin()!
  return supa.from('contacts').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
}
```

- [ ] **Step 2: Rodar tsc e ajustar call-sites**

Run: `npx tsc --noEmit`
O tsc vai apontar CENTENAS de erros nos call-sites (esperado). Para cada, ler o `tenantContext.tenantId` (via `getTenantContext()`) na rota API e passar. Em rotas sem contexto de usuário (workers/webhook), lançar um erro por enquanto: `throw new Error('rota sem contexto de tenant — cobrir na Fase 2B')`. Isso força-nos a NÃO deixar caminhos silenciosos.

Como isso são ~centenas de mudanças mecânicas, executar por *diretório* (`app/api/campaigns/**`, depois `app/api/contacts/**`, etc.) com um commit por diretório.

- [ ] **Step 3: Testes**

Run: `npx vitest run lib/ app/api/`
Expected: PASS (com atualização dos mocks nos testes existentes de rotas para passar `tenantId`).

- [ ] **Step 4: Commit final da task**

```bash
git commit -am "refactor(multitenancy): camada de dados escopada por tenantId em todas as *Db"
```

---

### Task 7: `platform_settings` — CRUD e migração de call-sites globais

**Files:**
- Create: `lib/platform-settings.ts`, `lib/platform-settings.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin`.
- Produces: `platformSettingsDb.get(key)`, `.set(key, value)`, `.delete(key)`.

- [ ] **Step 1: Escrever teste + implementação (TDD, análogo à Task 5).**
- [ ] **Step 2: Identificar chaves de plataforma (não-tenant) atualmente lidas via `settingsDb`.** Grep: `git grep -n "settingsDb\.(get|set)('session_tokens'\|'vercel_" -- app/ lib/`. Migrar essas para `platformSettingsDb`.
- [ ] **Step 3: Rodar suite + build.** Commit: `refactor(multitenancy): platform_settings separado do settings per-tenant`.

---

### Task 8: Middleware `proxy.ts` — trocar cookie legado por sessão Supabase

**Files:** Modify `proxy.ts`.

**Interfaces:**
- Consumes: `getTenantContext`.
- Produces: `x-tenant-id` no request quando há sessão; redirect para `/login` quando não.

- [ ] **Step 1: Substituir o bloco que checa `smartzap_session` por leitura da sessão Supabase (`@supabase/ssr` no middleware).**
- [ ] **Step 2: Rotas `PUBLIC_PAGES`/`PUBLIC_API_ROUTES` seguem iguais.**
- [ ] **Step 3: Se `getUser()` retorna usuário mas `current_tenant_id()` retorna null → provisionar (chamar rota interna que chama `provisionTenantForUser`).**
- [ ] **Step 4: Rodar build + smoke local (abrir `/login`, entrar, confirmar cookie `sb-*` presente).**
- [ ] **Step 5: Commit:** `refactor(auth): proxy usa sessão Supabase e injeta x-tenant-id`.

---

### Task 9: Login / callback / magic link

**Files:**
- Create: `app/api/auth/magic-link/route.ts`, `app/api/auth/callback/route.ts`
- Modify: `app/(auth)/login/page.tsx` — remover campo senha; formulário simples de email.

- [ ] **Step 1:** rota `magic-link` chama `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${APP_URL}/api/auth/callback` } })`.
- [ ] **Step 2:** rota `callback` faz `exchangeCodeForSession`, depois provisiona tenant se necessário, redireciona para `/`.
- [ ] **Step 3:** `/login/page.tsx` — form controlado que POSTa no `magic-link` e mostra "cheque seu email".
- [ ] **Step 4:** teste E2E (Playwright) opcional; unit tests para as rotas.
- [ ] **Step 5:** Commit: `feat(auth): login/callback magic link`.

---

### Task 10: Aposentar `MASTER_PASSWORD` da auth de usuário

**Files:** Modify `lib/user-auth.ts`, `app/api/auth/setup/route.ts`, `app/api/auth/status/route.ts`, `app/api/[transport]/route.ts`.

- [ ] **Step 1:** remover funções e call-sites de MASTER_PASSWORD **exceto** `app/api/installer/*` e `lib/installer/bootstrap.ts` (o comentário/plano deixa claro que ali é o único uso restante).
- [ ] **Step 2:** `/api/auth/status` passa a reportar login via Supabase.
- [ ] **Step 3:** `/api/[transport]` deixa de aceitar MASTER_PASSWORD como admin key; usar `SMARTZAP_ADMIN_KEY` ou papel `platform_admin`.
- [ ] **Step 4:** Testes + build. Commit: `chore(auth): remover MASTER_PASSWORD como login de usuário`.

---

### Task 11: Seed do 1º `platform_admin`

**Files:** Create `scripts/seed-platform-admin.ts`.

- [ ] **Step 1:** script recebe `--email` como argumento; usa service key; encontra o `auth.users` por email; insere em `platform_admins`. Idempotente.
- [ ] **Step 2:** Documentar no runbook do cutover.
- [ ] **Step 3:** Commit: `chore(auth): script seed-platform-admin`.

---

### Task 12: Teste de integração — isolamento entre 2 tenants

**Files:** Create `tests/integration/tenant-isolation.test.ts`.

- [ ] **Step 1:** Vitest test que usa o banco de dev (ou uma instância Supabase local): cria 2 tenants A e B, insere 1 contato em A e 1 em B via `contactDb`; verifica que `contactDb.getAll(tenantA)` retorna só o de A. Depois faz o mesmo caminho com o **client de browser** simulando dois usuários JWT diferentes e conta as linhas visíveis: cada um deve ver só o seu (isso valida RLS).
- [ ] **Step 2:** Commit: `test(multitenancy): isolamento entre tenants (data layer + RLS)`.

---

### Task 13: Documentação e atualização do runbook

**Files:** Modify `docs/superpowers/runbooks/2026-07-08-cutover-fase1.md` OR create `docs/superpowers/runbooks/2026-07-XX-cutover-fase2a.md`.

- [ ] **Step 1:** Passos operacionais para o 2A: rodar migrações, executar `purge-dev-data.ts`, seed do 1º admin, ativar magic link no Supabase (Auth → Email Templates), atualizar Envs.
- [ ] **Step 2:** Commit: `docs(2A): runbook + notas de integração multi-tenant`.

---

## Notas de execução

- **Tasks 1–4 (SQL) rodam contra o banco de dev** — precisa de `DATABASE_URL` válida. Se o ambiente de execução não tiver acesso, deferir aplicação p/ cutover e validar apenas com `tsc`/`schema:parity` local.
- **Task 6 é a mais volumosa** (~centenas de call-sites atualizados). Aceitável dividir em vários commits por diretório.
- **Task 8 (proxy)** é onde o "corte" acontece — antes dela, o app ainda usa `MASTER_PASSWORD`. Depois dela, obriga sessão Supabase.
- **Task 10** só depois da 8 estar aprovada (evita ficar sem auth).
- Ordem recomendada: 1 → 2 → 3 → 4 → 5 → 6 (por diretório) → 7 → 8 → 9 → 10 → 11 → 12 → 13.
