# Fase 2A — Identidade + Modelo de Tenant + Isolamento

**Data:** 2026-07-08
**Produto:** SmartZap SaaS (`smartzap-saas`)
**Status:** Design aprovado — pronto para virar plano de implementação
**Depende de:** Fase 1 (migração de infra) — concluída e mergeada em `main`.

---

## Contexto

O SmartZap é hoje **single-tenant**: sem contas de usuário, autenticação por `MASTER_PASSWORD` única, e todo dado num único pool (`public`, ~40 tabelas, sem `tenant_id`). O RLS está habilitado em todas as tabelas mas **sem policies por-usuário** — o app usa `service_role` (que bypassa RLS) em todas as rotas. Comentário literal no schema: *"App é single-tenant e usa service_role (bypassa RLS) em todas as API routes."*

A Fase 2 transforma isso num **SaaS multi-tenant**. Ela foi decomposta em 3 sub-projetos (cada um com seu ciclo spec→plano→implementação):

| Sub | Sub-projeto | Entrega |
|---|---|---|
| **2A** | **Identidade + Modelo de Tenant + Isolamento** (este spec) | Supabase Auth (magic link), tabelas de tenant, `tenant_id` + RLS em todas as tabelas, escopo por tenant na camada de dados |
| 2B | Roteamento de Tenant nos Workers | Webhook Meta resolve tenant por WABA/phone; QStash/campanhas escopados |
| 2C | Onboarding self-service + trial | Fluxo de cadastro, wizard por-tenant, gating de trial/limites |

**Ordem:** 2A cria identidade+isolamento; 2B protege os caminhos sem JWT; 2C abre o self-service.

### Decisões de produto travadas (brainstorming)

- **Tenant** = organização modelada desde já (`tenant_id` em tudo), mas **1 usuário por conta no MVP** (caminho aberto para times depois).
- **SaaS net-new**: serve clientes novos. Instâncias atuais (ex.: GN Noronha) ficam nos deploys próprios delas. **Sem migração de dados legada.**
- **Signup self-service aberto** (a UX é 2C; o mecanismo "criar tenant no 1º login" nasce no 2A).
- **Isolamento híbrido (C)**: RLS (DB-enforced) nos caminhos com contexto de usuário + escopo por `tenant_id` na camada de dados nas rotas de máquina.
- **Auth 100% Supabase** (magic link), sessão única. Superadmin via papel `platform_admin`.
- **Roteamento**: domínio único (`app.vozzyup.com.br`) + tenant resolvido da sessão.

---

## Objetivos do 2A

1. Usuários se cadastram e entram via **Supabase Auth (magic link)**; o 1º login sem tenant cria um `tenant` + `tenant_members(owner)`.
2. Toda tabela de domínio tem `tenant_id`; **RLS** garante isolamento nos caminhos com contexto de usuário (essencial p/ Realtime); a **camada de dados** garante escopo por tenant nas rotas service_role.
3. O `tenant_id` do usuário logado é resolvido no middleware e disponível para todas as rotas/queries.
4. Um usuário `platform_admin` tem acesso cross-tenant (base para o painel de plataforma).
5. `MASTER_PASSWORD` deixa de ser login de usuário (aposentado da auth do dashboard).
6. Nenhuma regressão funcional para um tenant único operando normalmente (campanhas, inbox realtime, IA, workflows continuam funcionando, agora escopados).

## Não-objetivos (fora do 2A)

- Roteamento de tenant nos workers/webhook (2B).
- Credenciais WhatsApp por-tenant de fato + Embedded Signup (Fase 3). *O 2A só torna `settings` per-tenant, deixando o armazenamento pronto.*
- UX de onboarding, wizard por-tenant, trial/limites (2C).
- Times/múltiplos usuários por tenant, convites, papéis além de owner (Fase 4+). *O modelo `tenant_members` já suporta, mas o MVP expõe só o owner.*
- Billing (Fase 4).

---

## Decisões travadas

| Decisão | Escolha | Racional |
|---|---|---|
| Estratégia de isolamento | **Híbrido**: RLS nos caminhos user + escopo na camada de dados nas rotas service_role | Casa com os 3 clients Supabase existentes; RLS é essencial p/ isolar o Realtime do browser |
| Auth | **100% Supabase, magic link, sessão única** | Simplicidade; sem sistema de sessão duplo |
| Superadmin | Papel **`platform_admin`** (tabela + função SQL `is_platform_admin()`) | Unificado no Supabase; usável em policies RLS p/ acesso cross-tenant |
| `MASTER_PASSWORD` | **Aposentado da auth do dashboard**; permanece só como gate do wizard de instalação do operador (pré-Supabase) | Não pode depender de Supabase (chicken-and-egg no install), mas não é mais login de usuário |
| Roteamento | **Domínio único + tenant da sessão** | Sem DNS/cert wildcard; webhook único (roteado no 2B) |
| `settings` | Passa a **`(tenant_id, key)`** | Config (incl. credenciais WA) vira per-tenant |
| Modelo de tenant | `tenants` + `tenant_members` (1 owner no MVP) | Pronto para times sem retrabalho de schema |

---

## Modelo de dados

```sql
-- Novas tabelas de plataforma
tenants(
  id uuid PK default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  status text not null default 'trialing',   -- trialing | active | suspended
  trial_ends_at timestamptz,
  created_at timestamptz default now()
)

tenant_members(
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'owner',          -- owner | admin | member
  created_at timestamptz default now(),
  primary key (tenant_id, user_id)
)

platform_admins(
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
)
```

- **`tenant_id uuid references tenants(id)` adicionado a todas as ~40 tabelas de domínio.** Adicionado `NOT NULL` (net-new, sem backfill). Índice em `tenant_id` por tabela.
- **`settings`**: PK passa de `key` para `(tenant_id, key)`. Settings de plataforma (ex.: `session_tokens`, config global) migram para escopo de plataforma (um `tenant_id` reservado/nulo tratado como plataforma, OU tabela `platform_settings` separada — decidir no plano; preferência: `platform_settings` separada para não misturar).
- **Usuários** = `auth.users` (Supabase). Não criamos tabela `users` própria; perfis extras (se necessários) vão em `tenant_members`.

### Funções SQL auxiliares (SECURITY DEFINER)

```sql
current_tenant_id() returns uuid      -- tenant do auth.uid() via tenant_members (1 no MVP)
is_platform_admin(uid uuid) returns boolean
```

---

## Autenticação (Supabase Auth, magic link)

- Habilitar **Email OTP / magic link** no projeto Supabase (provedor de email configurado — env já previstas na Fase 1; provedor de email é setup de infra).
- **Login/Signup unificados:** usuário informa email → recebe magic link → sessão via cookie `@supabase/ssr`.
- **Criação de tenant no 1º login:** ao autenticar, se o usuário não tem linha em `tenant_members`, criar `tenant` (nome provisório derivado do email; a UX real é 2C) + `tenant_members(owner)`. Implementado server-side (rota/callback de auth), idempotente.
- **Superadmin:** usuário presente em `platform_admins`. Concede acesso cross-tenant (painel de plataforma — a UI é incremental; o 2A entrega a checagem de papel e o bypass de RLS via `is_platform_admin()`).
- **Seed do 1º platform_admin:** feito via script/rota administrativa protegida (o operador roda uma vez com a service key) — sem `MASTER_PASSWORD` de usuário.
- **`MASTER_PASSWORD`:** removido de `proxy.ts`/`lib/auth.ts` como caminho de login do dashboard. Mantido apenas como gate do wizard `/install` do operador (setup de infra), que roda antes de existir usuário Supabase.

---

## Resolução de contexto de tenant

```
Request → proxy.ts (middleware)
  ├─ sessão Supabase? → user_id → current_tenant_id() → injeta x-tenant-id no request
  ├─ platform_admin? → sem tenant fixo (ou tenant selecionado p/ impersonação, via header/param)
  └─ sem sessão → /login (exceto rotas públicas: /api/webhook, /api/health, /f, etc.)
```

- **Helper `getTenantContext(request)`** (server): retorna `{ tenantId, userId, isPlatformAdmin }`. Fonte única de verdade para as rotas.
- **Camada de dados (`lib/supabase-db.ts` e afins):** recebe/lê o `tenantId` do contexto e **sempre** aplica `.eq('tenant_id', tenantId)` em selects/updates/deletes e seta `tenant_id` em inserts. Centralizado; as rotas não repetem o filtro.
- Rotas públicas sem usuário (webhook, health) **não** têm tenant no 2A — o roteamento delas é o 2B.

---

## Isolamento (híbrido)

- **RLS habilitado com policies reais** em todas as tabelas de tenant:
  ```sql
  -- leitura/escrita permitida quando a linha pertence ao tenant do usuário,
  -- OU o usuário é platform_admin
  using ( tenant_id = current_tenant_id() or is_platform_admin(auth.uid()) )
  with check ( tenant_id = current_tenant_id() or is_platform_admin(auth.uid()) )
  ```
- **Por que RLS importa mesmo mantendo service_role nas rotas:** o **client de browser** (`getSupabaseBrowser`) e o **Realtime** (`CentralizedRealtimeProvider`) acessam o banco com a sessão do usuário. Sem RLS, um tenant receberia dados/eventos realtime de outro. RLS fecha isso no banco.
- **Rotas API (service_role)** continuam bypassando RLS → o **enforcer nelas é a camada de dados** (escopo por `tenant_id`). RLS é defesa-em-profundidade.
- **Realtime:** garantir que as subscriptions do browser sejam por-tenant (RLS + filtros de canal por `tenant_id`).

---

## Rollout (net-new)

- **Migração SQL nova** (`supabase/migrations/…`): cria `tenants`/`tenant_members`/`platform_admins`, funções auxiliares, adiciona `tenant_id` + índices em todas as tabelas de domínio, converte `settings` para per-tenant (+ `platform_settings`), habilita RLS com policies.
- **Sem backfill** (SaaS net-new). A migração assume tabelas vazias de dados de produção SaaS.
- **Ordem de corte:** como não há dados legados, `tenant_id NOT NULL` direto é aceitável. (Se o banco de dev tiver dados de teste, limpar antes ou criar um tenant de dev e backfillar — decisão do plano.)
- **`schema-parity`/baseline:** o projeto tem scripts de paridade de schema (`scripts/schema-parity-check.ts`); a migração deve manter a baseline consistente.

---

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Uma rota service_role esquece o filtro de `tenant_id` → vazamento entre tenants | **Alto** | Centralizar 100% do acesso na camada de dados; RLS como backstop nos caminhos user; teste automatizado que cria 2 tenants e verifica isolamento |
| Realtime do browser vazando eventos entre tenants | Alto | RLS nas tabelas + filtros de canal por `tenant_id`; teste de isolamento de realtime |
| `settings` per-tenant quebra leitura de credenciais/config existentes | Médio | Migrar todos os call-sites de `settingsDb` para escopo de tenant; `platform_settings` separado para config global |
| Criação de tenant no 1º login com corrida/duplicidade | Médio | Idempotência (unique em membership) + transação |
| Migração `tenant_id NOT NULL` falha se houver dados de dev | Médio | Plano decide: limpar dados de dev ou tenant de dev + backfill |
| `MASTER_PASSWORD` removido quebra o gate do install do operador | Médio | Preservar o uso em `/install` (operador), remover só do login de usuário |

---

## Pendências / premissas a confirmar na implementação

- Provedor de email do Supabase (magic link) configurado no projeto (setup de infra/operador).
- Decisão `platform_settings` separada vs `tenant_id` reservado para plataforma (preferência: separada).
- Estratégia exata para dados de dev existentes no banco (limpar vs tenant de dev + backfill).
- Lista completa das ~40 tabelas que recebem `tenant_id` (extraída do `init.sql` no plano).
- Ajuste dos ~scripts/functions SQL existentes (RPCs com `GRANT ... TO service_role`) para respeitar/receber `tenant_id`.

---

## Próximo passo

Após revisão e aprovação deste spec, seguir para a skill **writing-plans** e produzir o plano de implementação detalhado do 2A.
