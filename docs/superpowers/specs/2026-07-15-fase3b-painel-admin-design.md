# Fase 3B — Painel de Administrador — Design

**Contexto:** Segunda fatia da frente 3. A 3A entregou `plans` (limites editáveis) + `tenants.plan_id` + `lib/plan-limits`. Já existem: `is_platform_admin(uid)`, `getTenantContext().isPlatformAdmin`, `tenants` (`status`, `trial_ends_at`, `plan_id`), `tenant_members` (`role`, `user_id`), auth por senha + trial (3.2), rotas de sistema/debug atrás de platform_admin (2C). **Não há tela de admin.**

**Goal:** Um painel `/admin`, acessível só a `platform_admin`, para: listar tenants com uso real vs limite, abrir um tenant (trocar plano, suspender/reativar, ver seus usuários), e editar os limites dos planos — tudo com barreira de autorização no servidor.

**Fora de escopo:** gestão *editável* de usuários (criar/remover/dar acesso) — no admin a visão de usuários é **só leitura**; a gestão de equipe é feita pelo owner dentro do tenant, candidata a uma fase futura. Cobrança/gateway (não entra). Criar tenant manualmente (auto-cadastro da 3.2 cobre a entrada).

## Decisões (aprovadas no brainstorm)

- Acesso: rota `/admin` (grupo de páginas próprio) + `/api/admin/*`. Gate `platform_admin`: página redireciona não-admin; API retorna 403. Link pro `/admin` no menu só para platform_admin.
- Bloqueio: `tenants.status = 'suspended'`. O gate de sessão (junto do trial, no layout do dashboard) redireciona tenant suspenso para `/conta-suspensa` (dados preservados). Reativar → `status='active'`.
- Uso real aparece **na listagem** (não só no detalhe) — via uma RPC agregada (1 query conta todos os tenants de uma vez).
- Primeiro super-admin (Fernando) marcado como `platform_admin` via SQL/MCP no deploy (operacional, no runbook).

## Global Constraints

- Autorização real é server-side: TODA rota `/api/admin/*` revalida `getTenantContext().isPlatformAdmin` → 403 se não. O gate de UI é conveniência, não barreira.
- Fail-closed: erro ao resolver contexto → tratar como não-admin (403/redirect), nunca liberar.
- Não alterar o comportamento do trial (3.2) nem dos gates de plano (3A). O gate de suspensão é adicionado ao lado do de trial, não no lugar.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Migrações versionadas em `supabase/migrations/` E aplicadas via MCP.
- Branch: `saas/fase-3b-admin` a partir de `main`.

## Componentes

### 1. Schema + contexto
- **Migração `<ts>_tenant_status.sql`:** documentar os valores de `tenants.status` (`'trialing'`, `'active'`, `'suspended'`). `status` já é `text`; adicionar `suspended_at timestamptz` (auditoria de quando/por quê, nulo quando ativo). Sem constraint rígida para não quebrar valores existentes.
- **`lib/tenant-context.ts`:** `TenantContext` ganha `suspended: boolean` (lido de `tenants.status='suspended'`; `false` para platform admin). A leitura de tenant já existe (para `trialExpired`) — reaproveitar, sem query extra.

### 2. RPC agregada de listagem — `admin_list_tenants`
- **Migração `<ts>_admin_list_tenants.sql`:** função `admin_list_tenants()` `SECURITY DEFINER`, que no início faz `IF NOT is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'`. Retorna, por tenant: `id, name, slug, status, trial_ends_at, plan_slug, plan_name, max_contacts, max_templates, max_campaigns_per_month, max_whatsapp_numbers, used_contacts, used_templates, used_campaigns_month, used_whatsapp_numbers`. Contagens via subselects/LATERAL agregando `contacts`/`templates`/`campaigns`(mês)/`whatsapp_phone_numbers` por tenant — uma passada, sem N+1.
- Consumida só pela rota `GET /api/admin/tenants`.

### 3. Rotas `/api/admin/*` (todas revalidam isPlatformAdmin → 403)
- `GET /api/admin/tenants` → chama a RPC, devolve a lista com uso vs limite.
- `GET /api/admin/tenants/[id]` → um tenant: dados + plano + uso (reusa a lógica de contagem de `lib/plan-limits`/RPC filtrada) + usuários (`tenant_members` join `auth.users` para e-mail; papel; created_at) — **leitura**.
- `PATCH /api/admin/tenants/[id]` → corpo `{ planSlug?, status? }`. `planSlug`: seta `plan_id` do plano; se promover de trial p/ pago, zera `trial_ends_at`. `status`: `'suspended'` (seta `suspended_at=now()`) ou `'active'` (limpa `suspended_at`). Valida valores.
- `GET /api/admin/plans` → lista `plans`.
- `PATCH /api/admin/plans/[id]` → corpo com os limites (`max_contacts`, `max_templates`, `max_campaigns_per_month`, `max_whatsapp_numbers`); atualiza `plans` + `updated_at`. Valores `null` = ilimitado; inteiros ≥ 0.

Um helper `requirePlatformAdmin()` (em `lib/admin-auth.ts`) centraliza o gate: resolve `getTenantContext`, retorna `ctx` ou lança/retorna 403. Usa admin client para as escritas (não depende de RLS).

### 4. Páginas `/admin`
- **`app/admin/layout.tsx`** (server): resolve `getTenantContext`; se `!isPlatformAdmin` → `redirect('/')`. Casca simples própria (não o shell do cliente).
- **`app/admin/page.tsx`** — lista de tenants (tabela com uso vs limite, busca por nome). Client component consumindo `GET /api/admin/tenants`.
- **`app/admin/tenants/[id]/page.tsx`** — detalhe: trocar plano (select), botão suspender/reativar, tabela de usuários (leitura).
- **`app/admin/plans/page.tsx`** — editar limites de cada plano (form por plano, salva via `PATCH /api/admin/plans/[id]`).
- **Menu:** adicionar entrada "Admin" (rota `/admin`) no `DashboardShell`/sidebar, renderizada só se `isPlatformAdmin` (o shell já tem acesso ao contexto; se não tiver, buscar via um endpoint leve `/api/auth/status` ou o contexto já disponível).

### 5. Gate de suspensão + tela
- **`app/(dashboard)/layout.tsx`:** ao lado do gate de trial já existente, adicionar `if (ctx?.suspended) redirect('/conta-suspensa')`. Platform admin nunca é suspenso.
- **`app/conta-suspensa/page.tsx`** — server component fora do shell (como `/trial-expirado`): "Sua conta está suspensa — fale conosco", com contato. Adicionar `/conta-suspensa` a `PUBLIC_PAGES` no proxy (alcançável pelo usuário logado-suspenso, sem loop).
- **Disparo de campanha / IA:** análogo ao trial — tenant suspenso não dispara. Reusar o ponto onde o trial já bloqueia (`campaign/dispatch`, `ai/respond`, webhook): checar suspensão junto. (Ou: a suspensão implica bloqueio total via layout; para os workers sem sessão, adicionar checagem de `status='suspended'` junto da de trial já existente.)

## Data Flow

```
/admin/* (página) → layout resolve isPlatformAdmin → não: redirect '/'
Ação de escrita → PATCH /api/admin/... → requirePlatformAdmin() → 403 se não
  admin → aplica no banco (admin client) → devolve estado novo
Tenant suspenso → login ok → getTenantContext.suspended=true → layout redireciona /conta-suspensa
```

## Error Handling
- Não-admin em qualquer rota admin: 403 (API) / redirect '/' (página). Sempre.
- PATCH com plano/status inválido: 400. Tenant inexistente: 404.
- Falha ao resolver contexto: tratar como não-admin (fail-closed).
- RPC `admin_list_tenants` chamada por não-admin: `RAISE EXCEPTION` (defesa em profundidade além do gate da rota).

## Testing
- `lib/admin-auth.test.ts`: `requirePlatformAdmin` — admin passa; não-admin → 403; contexto nulo → 403.
- Rotas: `GET /api/admin/tenants` (não-admin 403; admin lista); `PATCH tenants/[id]` (troca plano zera trial; suspend seta status; não-admin 403); `PATCH plans/[id]` (edita limite; não-admin 403).
- Gate de suspensão: `getTenantContext` devolve `suspended` correto; layout redireciona (teste do helper, não da página).
- Páginas não exigem teste automatizado (padrão do repo: testar rotas/lib).
- Sem regressão. `tsc`/`build` limpos.

## Rollback
Reverter os commits. Colunas/RPC podem permanecer inertes. Gate de suspensão falha fechado (erro → não libera). `tenants.status` volta a ser ignorado se o gate for revertido.
