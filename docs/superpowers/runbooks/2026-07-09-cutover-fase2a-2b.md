# Cutover Fase 2A + 2B — Fundação Multi-tenant + Resolução de Tenant em Webhooks

Procedimento operacional para levar o SmartZap de single-tenant (`MASTER_PASSWORD`) para
multi-tenant (Supabase Auth via magic link + RLS por `tenant_id`), incluindo a resolução de
tenant nos webhooks sem sessão (Meta WhatsApp, WhatsApp Flows, Google Calendar) e o fix do
workflow builder (Fase 2B).

Plano 2A: `docs/superpowers/plans/2026-07-08-fase2a-multitenancy-foundation.md`
Spec 2A: `docs/superpowers/specs/2026-07-08-fase2a-multitenancy-foundation-design.md`
Plano 2B: `docs/superpowers/plans/2026-07-09-fase2b-webhook-tenant-resolution.md`
Spec 2B: `docs/superpowers/specs/2026-07-09-fase2b-webhook-tenant-resolution-design.md`
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
20260709000001_multitenancy_webhook_tenant_mapping.sql
```

A última (`20260709000001`, Fase 2B) cria `whatsapp_phone_numbers` (com coluna
`flows_webhook_token`) e `google_calendar_channels` — as tabelas de mapeamento que resolvem
tenant a partir de `phone_number_id`/`channel_token`/token de Flows nos webhooks sem sessão.
Inclui `GRANT` explícito ao role `authenticated` (achado no planejamento da 2B: RLS sozinho
não expõe a tabela via Data API/PostgREST — as tabelas de plataforma da Fase 2A também não
têm esse GRANT, ver "Bloqueadores conhecidos" abaixo).

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

## 6. Bloqueadores conhecidos antes do cutover de produção

Extraído do ledger (`.superpowers/sdd/progress.md`). Revisar/mitigar antes do cutover de
produção, ou aceitar o risco conscientemente.

### Resolvidos pela Fase 2B

- ~~Workflow builder quebrado~~ — `lib/builder/workflow-db.ts` (7 funções) e as 13 rotas que
  as chamam agora exigem `tenantId` e escrevem `tenant_id` nos inserts. Corrigido também um
  vazamento cross-tenant real que não estava no escopo original: `fetchWorkflowRecord`/
  `listWorkflowRecords` liam sem filtro de tenant (qualquer tenant com um `workflowId`
  alheio conseguia lê-lo), e várias rotas (`[workflowId]` DELETE, `publish`, `rollback`,
  `run`) faziam update/insert/delete sem filtro de tenant nas tabelas
  `workflows`/`workflow_versions`/`workflow_runs`. Todos corrigidos.
- ~~Webhooks Meta e Google Calendar bloqueados~~ — `app/api/webhook/route.ts` resolve tenant
  por `phone_number_id` (tabela `whatsapp_phone_numbers`); o webhook do Calendar resolve por
  `channel_token` (tabela `google_calendar_channels`). Payload/token sem match → resposta
  silenciosa (200 para Meta, 401 para Calendar), não erro.
- ~~Endpoint de WhatsApp Flows bloqueado~~ — moveu de `/api/flows/endpoint` para
  `/api/flows/endpoint/[token]` (token opaco por tenant, `flows_webhook_token`). **Ação
  manual de onboarding**: tenants que já tinham um Flow publicado com endpoint configurado
  na Meta **precisam republicar o Flow** (ou atualizar a Endpoint URI manualmente no Meta
  Business Manager) para incluir o novo token — a URL antiga sem token não existe mais.
- ~~`webhook_verify_token` modelado como per-tenant~~ — virou config de plataforma
  (`platform_settings`), já que a URL do webhook é única e compartilhada por todos os
  tenants. **Ação manual se o ambiente de produção já tinha um token salvo per-tenant antes
  desta fase**: gerar um novo (automático, na primeira chamada ao webhook em modo não-readonly)
  ou copiar manualmente o valor antigo para `platform_settings` via
  `mcp__supabase__execute_sql` — e reconfigurar o `hub.verify_token` no App Dashboard da Meta
  se o valor mudou.

### Ainda pendentes

- **Backfill de `whatsapp_phone_numbers`/`google_calendar_channels` para tenants
  pré-existentes.** O write-through só roda em saves *novos* de credenciais (Task 3/4 da
  2B). Se o ambiente de produção já tinha tenants com credenciais salvas **antes** desta
  fase rodar, essas tabelas ficam vazias para eles — o webhook fica "ignorado" (200 sem
  processar) até uma resalvagem manual das credenciais. Sem script de backfill dedicado
  (YAGNI, volume de tenants baixo nesta fase do produto) — ação manual: cada tenant existente
  precisa reabrir Settings → WhatsApp e salvar as credenciais de novo (mesmo valor, só para
  disparar o write-through) antes do webhook voltar a funcionar para ele.
- **Queries diretas sem filtro de tenant fora dos objetos `*Db`/`workflow-db.ts`.** Não
  aparecem no `tsc` (não são erro de tipo). Notado em:
  - `app/api/settings/all/route.ts`, `app/api/settings/booking/route.ts`
  - `app/api/campaigns/[id]/route.ts` (GET), `resend-skipped`, `cancel-schedule`,
    `report.csv`, `app/api/campaign/[id]/cancel`
  - `app/api/webhook/route.ts` (~1650 linhas): só as queries que o `tsc` apontou foram
    corrigidas na 2A, mais 3 bugs óbvios de vazamento (clone de template, validate,
    preview/backfill) — sem auditoria linha-a-linha do arquivo inteiro. A 2B corrigiu a
    resolução de tenant no topo do handler (Task 6), mas não auditou o resto do arquivo.
  Risco: leitura cross-tenant via `service_role` (que bypassa RLS). Revisar antes do review
  final de produção.
- **[NOVO — achado no planejamento da 2B] `GRANT` de tabela ausente nas tabelas de
  plataforma da Fase 2A.** RLS sozinho não expõe uma tabela via Data API/PostgREST — precisa
  também de `GRANT SELECT/INSERT/UPDATE/DELETE ... TO authenticated`. As tabelas
  `whatsapp_phone_numbers`/`google_calendar_channels` (2B) já nasceram com o GRANT correto,
  mas `tenants`/`tenant_members`/`platform_admins`/`platform_settings` (2A) **não têm**.
  Como o acesso real da aplicação a essas 4 tabelas passa por RPCs `SECURITY DEFINER`
  (`current_tenant_id()`/`is_platform_admin()`, que executam com privilégios do dono da
  função, não do chamador) ou por `service_role`, isso não quebra o fluxo atual — mas
  qualquer feature futura que tente ler essas tabelas diretamente via client `authenticated`
  (ex.: uma tela de Settings mostrando membros do tenant) receberá `permission denied`, não
  uma lista vazia. Corrigir com `GRANT SELECT ON public.tenants, public.tenant_members,
  public.platform_admins, public.platform_settings TO authenticated;` antes do review final.
- **Handlers `execute`/`resume` do workflow builder não testados contra QStash real.** A
  correção da 2B (derivar tenant de `workflows.tenant_id` dentro de `context.run`) foi
  validada via `tsc`/build/suíte, mas não há teste de integração disparando o fluxo completo
  via QStash real. Testar manualmente: criar um workflow, executá-lo pela UI, confirmar que
  `workflow_runs.tenant_id` é preenchido corretamente.
- **Caso positivo de RLS não verificado end-to-end.** 2 usuários JWT reais, cada um vendo só
  o próprio tenant — **não foi verificado** automatizado (bloqueio de permissão ao tentar
  inserir usuário fake em `auth.users`, respeitado sem contornar). Risco residual baixo
  (mesma policy já testada indiretamente), mas gap de cobertura real — validar manualmente
  com 2 contas reais antes de produção (ver checklist abaixo).
- **`search_embeddings` (RAG) quebrado.** Pré-existente: os 2 overloads falham em runtime
  porque `search_path` não inclui o schema `extensions`, onde vive o operador do pgvector
  neste projeto. Fix = `SET search_path` incluindo `extensions`.
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
- [ ] **`npx tsc --noEmit`, `npm run build` e `npx vitest run`** limpos no commit que está
      sendo promovido a produção (baseline conhecido pós-2B: 0 erros tsc, build ok, 3448
      testes passando, 0 falhas).
- [ ] **Webhook Meta resolve tenant:** enviar uma mensagem de teste para um número WhatsApp
      já conectado a um tenant (via Settings → WhatsApp) e confirmar que ela aparece no
      Inbox do tenant correto. Enviar para um número **não** cadastrado em
      `whatsapp_phone_numbers` e confirmar no log que a mensagem foi ignorada (200,
      `reason: unknown_phone_number_id`) em vez de processada para o tenant errado.
- [ ] **Endpoint de Flows usa a URL com token:** em Settings → Flows, confirmar que a URL
      exibida (e a que é enviada à Meta ao publicar um Flow) inclui o segmento
      `/api/flows/endpoint/<token>`, não a URL antiga sem token.
- [ ] Revisar a seção "Bloqueadores conhecidos" acima — em especial o GRANT ausente nas
      tabelas de plataforma da 2A e o backfill de `whatsapp_phone_numbers` para tenants
      pré-existentes — e decidir explicitamente se algum precisa de correção antes deste
      cutover ou se o risco é aceito conscientemente.
