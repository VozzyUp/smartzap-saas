# Cutover Fase 2A — Fundação Multi-tenant

Procedimento operacional para levar o SmartZap de single-tenant (`MASTER_PASSWORD`) para
multi-tenant (Supabase Auth via magic link + RLS por `tenant_id`).

Plano: `docs/superpowers/plans/2026-07-08-fase2a-multitenancy-foundation.md`
Spec: `docs/superpowers/specs/2026-07-08-fase2a-multitenancy-foundation-design.md`
Ledger completo (decisões, achados, commits): `.superpowers/sdd/progress.md`

Este runbook assume um projeto Supabase **novo ou já rodando o baseline single-tenant**
(38 tabelas de domínio, sem `tenant_id`). Se o projeto de produção já roda a Fase 2A,
pule direto para a seção "Verificação pós-cutover".

---

## Pré-requisitos

- [ ] Branch `saas/fase-2-multitenancy` mergeada em `main` (ou deploy a partir dela).
- [ ] Acesso ao projeto Supabase de produção (dashboard + credenciais de service role).
- [ ] Confirmar se o baseline (`supabase/migrations/00000000000000_init.sql` +
      `20260204000000_*.sql` + `20260225000001_*.sql` + `20260225000002_*.sql`) já foi
      aplicado no projeto de produção. Se não, aplicar **antes** das migrações desta fase
      (ver Task 0 do ledger — neste projeto de dev nenhuma das 4 estava aplicada e precisou
      ser rodada primeiro).

---

## 1. Aplicar as migrações da Fase 2A

Ordem obrigatória (dependem umas das outras):

```
20260708000001_multitenancy_platform_tables.sql
20260708000002_multitenancy_add_tenant_id.sql
20260708000003_multitenancy_rls_policies.sql
20260708000004_multitenancy_scope_rpcs.sql
20260708000005_multitenancy_unique_per_tenant.sql
```

**Opção A — `supabase` CLI instalado no ambiente de produção:**

```bash
supabase db push
```

Aplica todas as migrações pendentes de `supabase/migrations/` na ordem correta, registrando
no histórico (`supabase_migrations.schema_migrations`).

**Opção B — CLI não instalado (caso deste ambiente de dev):**

Neste ambiente de desenvolvimento o `supabase` CLI **não estava instalado** (sem
`supabase/config.toml`), então as 9 migrações da Fase 2A (Task 0 + Tasks 1/3/4/4b/unique)
foram aplicadas via MCP:

- `mcp__supabase__apply_migration` (ou `mcp__claude_ai_Supabase__apply_migration`) — grava
  histórico de migração, equivalente ao `db push`. Usar para os 5 arquivos acima, na ordem,
  passando o conteúdo de cada arquivo e um nome derivado do próprio filename.
- `mcp__supabase__execute_sql` — só para SQL exploratório/iteração (verificações,
  smoke tests), nunca para o schema final.

Depois de aplicar, confirmar com `mcp__supabase__list_migrations` que as 5 aparecem no
histórico, e com `mcp__supabase__list_tables` que as 38 tabelas de domínio têm `tenant_id`.

**Verificação obrigatória após aplicar (ambas as opções):**

- [ ] `mcp__supabase__get_advisors` (security + performance) — sem findings novos além dos
      já conhecidos e documentados abaixo em "Bloqueadores conhecidos".
- [ ] Confirmar 38 tabelas de domínio com `tenant_id uuid NOT NULL` + índice.
- [ ] Confirmar 0 policies `anon_select_*` remanescentes (o baseline cria 7 policies
      `FOR SELECT TO anon USING (true)` em `contacts`, `campaigns`, `templates`, `flows`,
      `inbox_conversations`, `inbox_messages`, `account_alerts` — a migração
      `20260708000003` as dropa; confirmar que sumiram, pois com a chave `anon` pública
      elas vazam dados de todos os tenants).
- [ ] Confirmar `settings` com PK composta `(tenant_id, key)`.

---

## 2. Purgar dados de dev (se aplicável)

Só necessário se o banco de destino já tem dados de dev/teste que precisam ser limpos
**antes** da migração 2 (`add_tenant_id`) tornar `tenant_id NOT NULL` nas 38 tabelas —
inserts/linhas existentes sem `tenant_id` quebrariam a migração. **Não é necessário em
banco novo** (schema aplicado do zero, já nasce com `tenant_id NOT NULL`).

```bash
npx tsx scripts/purge-dev-data.ts --yes-really-purge
```

- Requer `DATABASE_URL` no ambiente (conexão Postgres direta, não a URL do Supabase REST).
- TRUNCATE das 38 tabelas de domínio (`RESTART IDENTITY CASCADE`); preserva `tenants`,
  `tenant_members`, `platform_admins`, `platform_settings` e o histórico de migrações.
- Sem `--yes-really-purge` o script recusa rodar (exit code 2) — proteção contra execução
  acidental.
- **Nota do ledger:** este script não foi testado contra um banco real neste ambiente
  (sem `DATABASE_URL` disponível durante o desenvolvimento) — validar em ambiente de
  staging antes de rodar contra produção, se possível.

---

## 3. Seed do primeiro `platform_admin`

```bash
npx tsx scripts/seed-platform-admin.ts --email=<email do primeiro admin>
```

- Requer no ambiente: `NEXT_PUBLIC_SUPABASE_URL` e (`SUPABASE_SECRET_KEY` ou
  `SUPABASE_SERVICE_ROLE_KEY`).
- O usuário informado **precisa já existir em `auth.users`** (ter feito login/signup pelo
  menos uma vez via magic link). Se não existir, o script falha com mensagem clara —
  peça para a pessoa fazer o primeiro login e rode de novo.
- Idempotente: `upsert` em `platform_admins(user_id)`, pode reexecutar sem duplicar.

---

## 4. Ativar magic link no Supabase Dashboard

No projeto Supabase de produção:

- **Auth → URL Configuration:**
  - [ ] `Site URL` = `https://app.vozzyup.com.br` (ou o domínio de produção correspondente).
  - [ ] `Redirect URLs` — adicionar `https://app.vozzyup.com.br/api/auth/callback` (a rota
        que faz `exchangeCodeForSession` e provisiona o tenant no primeiro login — ver
        `app/api/auth/callback/route.ts`). Incluir também a URL de qualquer ambiente de
        staging que use magic link.
- **Auth → Providers → Email:**
  - [ ] Confirmar que "Email" está habilitado como provider e que "Confirm email" /
        "Magic Link" está ativo (o fluxo usa `signInWithOtp`, disparado por
        `app/api/auth/magic-link/route.ts`).
- **Auth → Email Templates:**
  - [ ] Revisar o template "Magic Link" (idioma, branding). Confirmar que o link gerado
        aponta para `{{ .SiteURL }}/api/auth/callback` (padrão do Supabase) e não para uma
        URL antiga.
- [ ] Enviar um magic link de teste para um email próprio e confirmar que o redirect chega
      em `/api/auth/callback` e não em 404.

---

## 5. Variáveis de ambiente

Variáveis relevantes para esta fase, já presentes em `.env.example` (grupo "Supabase"):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SECRET_KEY=
```

- `NEXT_PUBLIC_SUPABASE_URL` — URL do projeto Supabase de produção.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — chave pública
  usada pelo client de browser (sessão via `@supabase/ssr`, RLS aplicado).
- `SUPABASE_SECRET_KEY` (canônica neste projeto) ou `SUPABASE_SERVICE_ROLE_KEY` (compat) —
  usada por `getSupabaseAdmin()` e pelos scripts `seed-platform-admin.ts` /
  `purge-dev-data.ts` (este último via `DATABASE_URL`, não via chave Supabase). Bypassa RLS
  — nunca expor no client.
- `MASTER_PASSWORD` — segue existindo em `.env.example`, mas nesta fase seu único uso
  legítimo é o gate do wizard `/install` (setup de infra do operador, `app/api/installer/*`
  e `lib/installer/bootstrap.ts`). Não é mais o mecanismo de login de usuário.

Nenhuma variável nova foi introduzida por esta fase além das já existentes no grupo
Supabase; o que mudou foi o **uso** (de single-tenant/`MASTER_PASSWORD` para sessão
Supabase por usuário).

---

## 6. Bloqueadores conhecidos antes de considerar a 2A pronta para produção

Extraído do ledger (`.superpowers/sdd/progress.md`, seção "Minor findings"). Revisar/mitigar
antes do cutover de produção, ou aceitar o risco conscientemente:

- **[CRÍTICO] Workflow builder quebrado.** `lib/builder/workflow-db.ts` (feature separada do
  workflow visual, ~11 call-sites em `app/api/builder/**`) insere em `workflows` e
  `workflow_versions` **sem `tenant_id`**, e ambas as tabelas têm `tenant_id NOT NULL` desde
  a migração `20260708000002`. `ensureWorkflowRecord`/`createWorkflowRecord`/
  `updateWorkflowRecord` vão **falhar em runtime** (violação de NOT NULL) assim que chamados.
  Não corrigido na Fase 2A (fora do escopo dos 10 objetos `*Db` da Task 6; mistura rotas com
  sessão e handlers `serve()` do Upstash Workflow sem sessão — precisa do mesmo padrão
  "derivar tenant do recurso" usado em `campaign/workflow`). **Se o workflow builder for
  usado em produção, isso é um crash garantido, não um nice-to-have.**
- **Webhooks Meta e Google Calendar intencionalmente bloqueados até a Fase 2B.**
  `app/api/webhook/**` e `app/api/integrations/google-calendar/webhook` chamam
  `resolveWebhookTenantId()`, que **sempre lança** hoje — deferral legítimo (não há recurso
  com `tenant_id` derivável do payload ainda; a Fase 2B mapeia `phone_number_id`/canal →
  tenant). Diferente da regressão do `campaign/dispatch` (corrigida durante a Task 6 —
  aquela rota atende disparo manual além de QStash e não podia ficar bloqueada). Enquanto o
  guard não for removido sem revisão, o risco é baixo; remover o guard sem mapear o tenant
  reabriria vazamento cross-tenant.
- **Queries diretas sem filtro de tenant fora dos objetos `*Db`.** Não aparecem no `tsc`
  (não são erro de tipo) e não foram cobertas pelos lotes mecânicos da Task 6. Notado em:
  - `app/api/settings/all/route.ts`, `app/api/settings/booking/route.ts`
  - `app/api/campaigns/[id]/route.ts` (GET), `resend-skipped`, `cancel-schedule`,
    `report.csv`, `app/api/campaign/[id]/cancel`
  - `app/api/webhook/route.ts` (~1600 linhas): só as queries que o `tsc` apontou foram
    corrigidas, mais 3 bugs óbvios de vazamento (clone de template, validate,
    preview/backfill) — sem auditoria linha-a-linha do arquivo inteiro. Risco baixo enquanto
    `resolveWebhookTenantId()` seguir bloqueando o fluxo; alto se alguém remover o guard sem
    revisar o resto do arquivo.
  Risco: leitura cross-tenant via `service_role` (que bypassa RLS). Revisar antes do review
  final de produção.
- **Caso positivo de RLS não verificado end-to-end.** A Task 12 verificou ao vivo (contra o
  projeto `vdgudeijxxbaghqaxpip`) que um usuário `authenticated` sem `tenant_members` vê 0
  linhas (caso negativo). O caso positivo — 2 usuários JWT reais, cada um vendo só o próprio
  tenant — **não foi verificado** (o subagente foi bloqueado por permissão ao tentar inserir
  um usuário fake em `auth.users`, corretamente, sem contornar). Risco residual considerado
  baixo (mesma policy `tenant_id = current_tenant_id()` já testada indiretamente na Task 4),
  mas é um gap de cobertura real — validar manualmente com 2 contas reais antes de produção
  (ver checklist abaixo).
- **`search_embeddings` (RAG) quebrado.** Pré-existente à Fase 2A: os 2 overloads falham em
  runtime porque `search_path` não inclui o schema `extensions`, onde vive o operador do
  pgvector neste projeto. Corrigir junto da Fase 2B/RAG ou no review final (fix = `SET
  search_path` incluindo `extensions`).
- **`increment_campaign_stat(p_campaign_id uuid, ...)` — overload uuid quebrado.** Compara
  `uuid` com `campaigns.id` (tipo `text`) → erro de operador. O overload com `text` funciona;
  confirmar qual overload os call-sites usam antes de depender dele.
- **`purge-dev-data.ts` não testado contra banco real** neste ambiente de desenvolvimento
  (sem `DATABASE_URL` disponível). Testar em staging antes de rodar contra produção.

---

## 7. Verificação pós-cutover (checklist rápido)

- [ ] **Login cria tenant no primeiro acesso:** acessar `/login`, pedir magic link para um
      email novo, clicar no link recebido, confirmar redirect para `/api/auth/callback` e
      depois para a home autenticada. Conferir no banco (`select * from tenant_members where
      user_id = '<uid>'`) que uma linha `role = 'owner'` foi criada — `proxy.ts` provisiona
      o tenant inline no primeiro login via `provisionTenantForUser`.
- [ ] **Isolamento entre tenants:** repetir o login com um segundo email (tenant B). Criar 1
      contato/campanha em cada tenant. Confirmar que o usuário do tenant B **não** vê os
      dados do tenant A (nem via UI, nem via `contactDb.getAll` de outro contexto) — isto
      cobre o caso positivo de RLS que a Task 12 não verificou automatizado.
- [ ] **`platform_admin` funciona:** logar com o email promovido na etapa 3; confirmar acesso
      a rotas/UI de administração de plataforma (`is_platform_admin()` retorna `true`).
- [ ] **Login legado desativado:** confirmar que `MASTER_PASSWORD` não é mais aceito como
      login de usuário (rota `/api/auth/status` reporta via Supabase; `lib/user-auth.ts`
      segue no repo mas não é mais chamado no caminho de login — ver Task 10, ainda
      pendente no ledger no momento da escrita deste runbook).
- [ ] **`npx tsc --noEmit` e `npx vitest run`** limpos no commit que está sendo promovido a
      produção (baseline conhecido: 0 erros tsc, 3416+ testes passando, 0 falhas).
- [ ] Revisar a seção "Bloqueadores conhecidos" acima e decidir explicitamente se o workflow
      builder e os webhooks Meta/Google Calendar ficam desabilitados/avisados na UI até a
      Fase 2B, ou se algum deles precisa de correção antes deste cutover.
