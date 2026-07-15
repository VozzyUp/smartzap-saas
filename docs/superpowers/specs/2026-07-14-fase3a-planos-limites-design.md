# Fase 3A — Modelo de Planos + Limites — Design

**Contexto:** Primeira fatia da frente 3 (painel admin / planos / gestão) do smartzap-saas. Hoje existe `tenants` (`id`, `name`, `slug`, `status`, `trial_ends_at`, `created_at`), `tenant_members` (`role`), `attendant_tokens`, e a função `is_platform_admin(uid)`. O trial de 3 dias (Fase 3.2) já bloqueia o app quando `trial_ends_at` expira. **Não existe modelo de planos.**

**Goal:** Introduzir planos (Trial, Básico, Pro) com limites por dimensão (números WhatsApp, contatos, templates, campanhas/mês) armazenados como dados editáveis no banco, e um gate server-side que bloqueia a ação que estouraria o limite com um 403 de upgrade.

**Fora de escopo (fica para 3B):** tela de admin para editar planos e trocar o plano de um tenant. Nesta 3A a troca de plano é manual via SQL/MCP. **Fora de escopo (fica para frente 4):** conectar de fato múltiplos números — aqui só entra o *limite* `max_whatsapp_numbers`.

## Decisões (aprovadas no brainstorm)

- Sem cobrança/gateway agora — só o modelo + limites; troca de plano manual.
- Três planos: `trial`, `basico`, `pro`. Planos são **registros no banco** (editáveis sem deploy — requisito para a tela de admin da 3B), não constantes de código.
- Limites de partida (ajustáveis depois): `NULL` = ilimitado.

  | Dimensão | trial | basico | pro |
  |---|---|---|---|
  | max_whatsapp_numbers | 1 | 1 | 3 |
  | max_contacts | 100 | 5000 | 50000 |
  | max_templates | 3 | 30 | NULL |
  | max_campaigns_per_month | 2 | 20 | NULL |

- Ao atingir o limite: **bloqueia a ação** que estouraria, com 403 `{ error: 'plan_limit', dimension, limit, current }`. O que já existe continua funcionando.
- `contatos` e `templates`: limite sobre o **total existente** do tenant. `campanhas/mês`: campanhas **iniciadas no mês-calendário corrente** (UTC).
- `is_platform_admin` nunca é limitado.
- Trial e plano convivem: `trial_ends_at` (Fase 3.2) segue valendo; ao promover para plano pago, o admin zera `trial_ends_at` (NULL = sem limite de tempo). Um tenant no plano `trial` com `trial_ends_at` expirado continua bloqueado pelo gate de trial já existente.

## Global Constraints

- Falha fechada e previsível: tenant sem plano resolvível → tratar como `trial` (o mais restritivo). Nunca liberar geral por erro de leitura.
- Toda checagem de limite é server-side (o client pode espelhar para UX, mas a barreira é no servidor).
- Não alterar o comportamento do trial da Fase 3.2 — planos são ortogonais a ele.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão sobre o total atual.
- Migrações versionadas em `supabase/migrations/` E aplicadas no projeto via MCP (mesmo fluxo das fases anteriores).

## Componentes

### 1. Schema — `plans` + `tenants.plan_id`

**Migração `<ts>_plans.sql`:**
```sql
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,               -- 'trial' | 'basico' | 'pro'
  name text NOT NULL,
  max_whatsapp_numbers integer,            -- NULL = ilimitado
  max_contacts integer,
  max_templates integer,
  max_campaigns_per_month integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (slug, name, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month, sort_order) VALUES
  ('trial',  'Trial',   1, 100,   3,  2,  0),
  ('basico', 'Básico',  1, 5000,  30, 20, 1),
  ('pro',    'Pro',     3, 50000, NULL, NULL, 2);

ALTER TABLE public.tenants ADD COLUMN plan_id uuid REFERENCES public.plans(id);
UPDATE public.tenants SET plan_id = (SELECT id FROM public.plans WHERE slug='trial') WHERE plan_id IS NULL;
```
RLS: `plans` é catálogo global de leitura (não tem `tenant_id`). Habilitar RLS com policy de `SELECT` para `authenticated` (todos podem ler o catálogo); escrita só via service role / platform admin (a tela de edição da 3B usará admin client). O provisionamento de tenant novo (`provisionTenantForUser`) passa a setar `plan_id` do `trial` no insert.

### 2. `lib/plan-limits.ts` — resolução e gate

- `getTenantPlan(tenantId): Promise<Plan>` — lê `tenants.plan_id` → `plans`; se nulo/erro, retorna o plano `trial` (fail-closed restritivo). Cacheável por request.
- Contadores (via admin client, escopados por tenant):
  - `countWhatsAppNumbers(tenantId)` — `whatsapp_phone_numbers` do tenant.
  - `countContacts(tenantId)` — `contacts` do tenant.
  - `countTemplates(tenantId)` — `templates` do tenant.
  - `countCampaignsThisMonth(tenantId)` — `campaigns` do tenant com `created_at >= date_trunc('month', now())`.
- Gate — cada função retorna `{ allowed: boolean; limit: number | null; current: number }`:
  - `canAddWhatsAppNumber(tenantId)`
  - `canAddContacts(tenantId, quantidade = 1)` — para import em lote, checa `current + quantidade <= limit`.
  - `canCreateTemplate(tenantId)`
  - `canStartCampaign(tenantId)`
- Regra comum: limite `NULL` → `allowed: true` sempre. `is_platform_admin` → `allowed: true` (checado no call-site via `getTenantContext().isPlatformAdmin`, que já existe).
- Helper de resposta: `planLimitResponse(dimension, r)` → `NextResponse.json({ error: 'plan_limit', dimension, limit: r.limit, current: r.current }, { status: 403 })`.

### 3. Pontos de aplicação (rotas de criação)

Cada rota, após resolver tenant e antes de criar:
- **Conectar número WhatsApp** — a rota que grava em `whatsapp_phone_numbers` (localizar na implementação: fluxo de credenciais/conexão). `canAddWhatsAppNumber`.
- **Criar/importar contato** — rota(s) de criação e import de `contacts`. `canAddContacts(tenantId, qtd)`.
- **Criar template** — rota de criação de template (`templates`/drafts que publica). `canCreateTemplate`.
- **Iniciar campanha** — a rota que cria/dispara campanha (`campaign/dispatch` ou a que insere em `campaigns`). `canStartCampaign`.

Em cada uma: se `!ctx.isPlatformAdmin` e `!allowed` → retorna `planLimitResponse(...)`. Não tocar em rotas de leitura/edição do que já existe.

## Data Flow

```
Ação de criação → getTenantContext() → isPlatformAdmin? → segue sem limite
  não-admin → getTenantPlan(tenantId) → count<Dim>(tenantId)
    current + delta <= limit (ou limit NULL)? → cria
    senão → 403 { error:'plan_limit', dimension, limit, current }
```

## Error Handling

- Plano não resolvível (FK nula, linha ausente, erro de leitura) → `trial` (mais restritivo). Logar `console.warn`, nunca lançar do gate.
- Contadores que falham na leitura → tratar como no limite (fail-closed): bloqueia em vez de liberar. Logar.
- Mensagens do 403 são estáveis e sem PII; o front traduz `dimension` para texto amigável ("Seu plano permite até N números — faça upgrade").

## Testing

- `lib/plan-limits.test.ts`: para cada gate — abaixo do limite passa; exatamente no limite bloqueia; acima bloqueia; `NULL` (ilimitado) passa; `getTenantPlan` com plan_id nulo → trial. Mockar admin client (contadores) e a leitura de `plans`.
- Um teste por rota que aplica o gate: 403 `plan_limit` ao estourar; admin isento (mock `getTenantContext` com `isPlatformAdmin: true`).
- Sem regressão na suíte existente. `tsc`/`build` limpos.

## Rollback

Reverter os commits. A coluna `tenants.plan_id` e a tabela `plans` podem permanecer (inertes se o gate for revertido). O gate falha fechado, então um bug de resolução causa 403 (bloqueio seguro), não liberação indevida.
