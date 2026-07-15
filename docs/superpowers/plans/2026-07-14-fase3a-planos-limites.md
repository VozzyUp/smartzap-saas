# Fase 3A — Modelo de Planos + Limites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir planos (Trial/Básico/Pro) com limites editáveis no banco e um gate server-side que bloqueia com 403 a criação que estouraria o limite de números WhatsApp, contatos, templates ou campanhas/mês.

**Architecture:** Uma tabela `plans` (catálogo global, limites como colunas, NULL = ilimitado) + `tenants.plan_id`. Um módulo `lib/plan-limits.ts` resolve o plano do tenant, conta o uso atual e expõe gates puros. Cada rota de criação aplica o gate após resolver o tenant, isentando platform admin. Falha fechada: sem plano → trial (mais restritivo).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Vitest.

## Global Constraints

- Falha fechada: tenant sem plano resolvível → tratar como `trial`. Contador que falha na leitura → tratar como no limite (bloqueia). Nunca liberar geral por erro; nunca lançar do gate (usar `console.warn`).
- `is_platform_admin` nunca é limitado (checar `ctx.isPlatformAdmin` no call-site).
- Limite `NULL` = ilimitado → sempre permite.
- `contatos`/`templates`: limite sobre total existente do tenant. `campanhas/mês`: `campaigns` com `created_at >= date_trunc('month', now())` (UTC).
- 403 de bloqueio tem shape estável: `{ error: 'plan_limit', dimension, limit, current }`.
- Não alterar o comportamento do trial da Fase 3.2 (planos são ortogonais).
- Migrações versionadas em `supabase/migrations/` E aplicadas via MCP do Supabase.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-3a-planos` a partir de `main`.

---

### Task 1: Schema `plans` + `tenants.plan_id` + provisionamento

**Files:**
- Create: `supabase/migrations/20260714130001_plans.sql`
- Modify: `lib/tenant-provisioning.ts`
- Test: `lib/tenant-provisioning.test.ts`

**Interfaces:**
- Produces: tabela `plans` (colunas abaixo); `tenants.plan_id uuid REFERENCES plans(id)`; `provisionTenantForUser` passa a inserir `plan_id` do plano `trial`. Assinatura de `provisionTenantForUser(userId, emailForName)` NÃO muda.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260714130001_plans.sql
-- Fase 3A: catálogo de planos + vínculo do tenant. Limite NULL = ilimitado.
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  max_whatsapp_numbers integer,
  max_contacts integer,
  max_templates integer,
  max_campaigns_per_month integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (slug, name, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month, sort_order) VALUES
  ('trial',  'Trial',   1, 100,   3,    2,    0),
  ('basico', 'Básico',  1, 5000,  30,   20,   1),
  ('pro',    'Pro',     3, 50000, NULL, NULL, 2);

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id);
UPDATE public.tenants SET plan_id = (SELECT id FROM public.plans WHERE slug='trial') WHERE plan_id IS NULL;

-- Catálogo global legível por qualquer usuário autenticado; escrita só via service role.
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read_authenticated ON public.plans FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.plans TO authenticated;
```

- [ ] **Step 2: Aplicar a migração no banco via MCP**

Aplicar via `mcp__supabase__apply_migration` (name `plans`, mesmo SQL). Verificar:
`SELECT slug, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month FROM plans ORDER BY sort_order` → 3 linhas com os valores acima.
`SELECT count(*) FROM tenants WHERE plan_id IS NULL` → 0.

- [ ] **Step 3: Teste que falha (provisionamento seta plan_id do trial)**

Adicionar a `lib/tenant-provisioning.test.ts`, no mesmo harness de mock de `getSupabaseAdmin` já usado no arquivo (o mock encadeia `from().insert().select().single()`; o teste captura o payload do insert em `tenants`). O provisionamento precisa resolver o id do plano trial — o mock de `from('plans').select().eq('slug','trial').single()` deve devolver `{ data: { id: 'plan-trial' } }`:

```ts
it('seta plan_id do plano trial ao criar tenant novo', async () => {
  // usar o harness existente; mockar a leitura de plans retornando o id do trial
  await provisionTenantForUser('u-plan', 'plan@empresa.com')
  const payload = insertedTenantsPayload() // último insert em 'tenants'
  expect(payload.plan_id).toBe('plan-trial')
})
```
(Estender o mock do harness para responder à leitura de `plans` sem quebrar os testes existentes.)

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run lib/tenant-provisioning.test.ts` → FAIL (`plan_id` undefined).

- [ ] **Step 5: Implementar**

Em `lib/tenant-provisioning.ts`, antes do insert em `tenants`, resolver o plano trial e incluí-lo no insert:

```ts
const { data: trialPlan } = await db.from('plans').select('id').eq('slug', 'trial').single()
const inserted = await db.from('tenants').insert({
  name: emailForName, slug: slugFromEmail(emailForName), status: 'trialing',
  trial_ends_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  plan_id: trialPlan?.id ?? null,
}).select('id').single()
```
(Mantém o `trial_ends_at` da Fase 3.2 — não removê-lo.)

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run lib/tenant-provisioning.test.ts` → PASS (todos, incluindo os pré-existentes).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260714130001_plans.sql lib/tenant-provisioning.ts lib/tenant-provisioning.test.ts
git commit -m "feat(3a): tabela plans + tenants.plan_id + provisionamento no trial"
```

---

### Task 2: `lib/plan-limits.ts` — resolução, contadores e gates (TDD)

**Files:**
- Create: `lib/plan-limits.ts`, `lib/plan-limits.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` de `@/lib/supabase`.
- Produces:
  - `type Plan = { id: string; slug: string; name: string; max_whatsapp_numbers: number | null; max_contacts: number | null; max_templates: number | null; max_campaigns_per_month: number | null }`
  - `type GateResult = { allowed: boolean; limit: number | null; current: number }`
  - `getTenantPlan(tenantId: string): Promise<Plan>` — lê `tenants.plan_id → plans`; nulo/erro → plano `trial` (lido de `plans`); se nem o trial resolver, retorna um Plan sintético com todos os limites 0 (fail-closed máximo).
  - `canAddWhatsAppNumber(tenantId: string): Promise<GateResult>`
  - `canAddContacts(tenantId: string, quantidade?: number): Promise<GateResult>` (default 1)
  - `canCreateTemplate(tenantId: string): Promise<GateResult>`
  - `canStartCampaign(tenantId: string): Promise<GateResult>`
  - `planLimitResponse(dimension: string, r: GateResult): NextResponse` — 403 `{ error:'plan_limit', dimension, limit, current }`.

- [ ] **Step 1: Teste que falha**

```ts
// lib/plan-limits.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const single = vi.fn()      // para .single() (tenant→plan, plans)
const count = vi.fn()       // para count queries
// Mock encadeável: from(table) devolve um builder cujos métodos retornam ele mesmo,
// exceto single()/os terminais de contagem.
vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const b: any = {}
    b.select = vi.fn((_cols?: string, opts?: { count?: string }) => {
      b._count = !!opts?.count
      return b
    })
    b.eq = vi.fn(() => b)
    b.gte = vi.fn(() => b)
    b.single = vi.fn(() => single(table))
    b.then = undefined
    // torna o builder "awaitable" para count queries
    b[Symbol.for('nodejs.util.inspect.custom')] = () => `builder(${table})`
    return new Proxy(b, {
      get(t, p) {
        if (p === 'then') {
          return (res: any) => Promise.resolve(count(table)).then(res)
        }
        return t[p as any]
      },
    })
  }
  return { getSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }) }
})

import { getTenantPlan, canAddContacts, canCreateTemplate, canStartCampaign, canAddWhatsAppNumber } from '@/lib/plan-limits'

const PLAN_TRIAL = { id: 'p-trial', slug: 'trial', name: 'Trial', max_whatsapp_numbers: 1, max_contacts: 100, max_templates: 3, max_campaigns_per_month: 2 }
const PLAN_PRO = { id: 'p-pro', slug: 'pro', name: 'Pro', max_whatsapp_numbers: 3, max_contacts: 50000, max_templates: null, max_campaigns_per_month: null }

beforeEach(() => { single.mockReset(); count.mockReset() })

// getTenantPlan: tenant com plano → devolve o plano
it('getTenantPlan devolve o plano do tenant', async () => {
  single.mockImplementation((table: string) =>
    table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
  expect((await getTenantPlan('t1')).slug).toBe('trial')
})

// getTenantPlan: plan_id nulo → cai no trial
it('getTenantPlan sem plan_id cai no trial', async () => {
  single.mockImplementation((table: string) =>
    table === 'tenants' ? { data: { plan_id: null } } : { data: PLAN_TRIAL })
  expect((await getTenantPlan('t1')).slug).toBe('trial')
})

// canAddContacts: abaixo do limite permite; no limite bloqueia
it('canAddContacts abaixo do limite permite', async () => {
  single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
  count.mockImplementation((table: string) => ({ count: 50 }))
  const r = await canAddContacts('t1', 1)
  expect(r).toEqual({ allowed: true, limit: 100, current: 50 })
})
it('canAddContacts no limite bloqueia', async () => {
  single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
  count.mockImplementation(() => ({ count: 100 }))
  const r = await canAddContacts('t1', 1)
  expect(r.allowed).toBe(false)
})

// limite NULL (ilimitado) sempre permite
it('canCreateTemplate ilimitado (NULL) permite', async () => {
  single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-pro' } } : { data: PLAN_PRO })
  count.mockImplementation(() => ({ count: 9999 }))
  const r = await canCreateTemplate('t1')
  expect(r).toEqual({ allowed: true, limit: null, current: 9999 })
})

// canStartCampaign conta o mês corrente
it('canStartCampaign no limite bloqueia', async () => {
  single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
  count.mockImplementation(() => ({ count: 2 }))
  const r = await canStartCampaign('t1')
  expect(r.allowed).toBe(false)
})
```

> Nota ao implementer: o mock acima ilustra a intenção (separar `.single()` de contagens). Se a cadeia real do supabase-js não casar com esse Proxy, **ajuste o harness de mock** para o padrão que o resto do repo usa (ver mocks de `getSupabaseAdmin` em `lib/tenant-provisioning.test.ts` / `lib/trial.test.ts`) — o que importa é testar os comportamentos: plano resolvido, abaixo/na/acima do limite, NULL ilimitado, fallback trial.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/plan-limits.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// lib/plan-limits.ts
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export type Plan = {
  id: string; slug: string; name: string
  max_whatsapp_numbers: number | null
  max_contacts: number | null
  max_templates: number | null
  max_campaigns_per_month: number | null
}
export type GateResult = { allowed: boolean; limit: number | null; current: number }

const PLAN_COLS = 'id, slug, name, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month'
// Fail-closed máximo: se nem o trial resolver, nada é permitido.
const ZERO_PLAN: Plan = { id: '', slug: 'trial', name: 'Trial', max_whatsapp_numbers: 0, max_contacts: 0, max_templates: 0, max_campaigns_per_month: 0 }

export async function getTenantPlan(tenantId: string): Promise<Plan> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return ZERO_PLAN
    const { data: tenant } = await db.from('tenants').select('plan_id').eq('id', tenantId).single()
    const planId = (tenant as { plan_id?: string } | null)?.plan_id
    if (planId) {
      const { data: plan } = await db.from('plans').select(PLAN_COLS).eq('id', planId).single()
      if (plan) return plan as Plan
    }
    const { data: trial } = await db.from('plans').select(PLAN_COLS).eq('slug', 'trial').single()
    return (trial as Plan) ?? ZERO_PLAN
  } catch (e) {
    console.warn('[plan-limits] getTenantPlan falhou, usando fail-closed:', e)
    return ZERO_PLAN
  }
}

async function countRows(table: string, tenantId: string, thisMonth = false): Promise<number> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return Number.MAX_SAFE_INTEGER // fail-closed: trata como cheio
    let q = db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    if (thisMonth) {
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
      q = q.gte('created_at', start)
    }
    const { count } = await q
    return count ?? Number.MAX_SAFE_INTEGER
  } catch (e) {
    console.warn(`[plan-limits] contagem de ${table} falhou, fail-closed:`, e)
    return Number.MAX_SAFE_INTEGER
  }
}

function gate(limit: number | null, current: number, delta = 1): GateResult {
  if (limit === null) return { allowed: true, limit: null, current }
  return { allowed: current + delta <= limit, limit, current }
}

export async function canAddWhatsAppNumber(tenantId: string): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_whatsapp_numbers, await countRows('whatsapp_phone_numbers', tenantId))
}
export async function canAddContacts(tenantId: string, quantidade = 1): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_contacts, await countRows('contacts', tenantId), quantidade)
}
export async function canCreateTemplate(tenantId: string): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_templates, await countRows('templates', tenantId))
}
export async function canStartCampaign(tenantId: string): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_campaigns_per_month, await countRows('campaigns', tenantId, true))
}

export function planLimitResponse(dimension: string, r: GateResult): NextResponse {
  return NextResponse.json({ error: 'plan_limit', dimension, limit: r.limit, current: r.current }, { status: 403 })
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run lib/plan-limits.test.ts` → PASS. `npx tsc --noEmit` → limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-limits.ts lib/plan-limits.test.ts
git commit -m "feat(3a): lib/plan-limits — getTenantPlan, contadores e gates (fail-closed)"
```

---

### Task 3: Gate em contatos (criar + importar)

**Files:**
- Modify: `app/api/contacts/route.ts` (POST, ~linha 89), `app/api/contacts/import/route.ts` (POST, ~linha 12)

**Interfaces:**
- Consumes: `canAddContacts`, `planLimitResponse` de `@/lib/plan-limits`; `ctx.isPlatformAdmin` de `getTenantContext` (já importado nas rotas).

- [ ] **Step 1: Aplicar em `contacts/route.ts` POST**

Após `if (!ctx?.tenantId) return ...401...` e antes de `const contact = await contactDb.add(ctx.tenantId, contactData)`:

```ts
if (!ctx.isPlatformAdmin) {
  const gate = await canAddContacts(ctx.tenantId, 1)
  if (!gate.allowed) return planLimitResponse('contacts', gate)
}
```
Adicionar o import: `import { canAddContacts, planLimitResponse } from '@/lib/plan-limits'`.

- [ ] **Step 2: Aplicar em `contacts/import/route.ts` POST**

Após resolver `ctx` e conhecer o array `contacts` (o que será importado), antes de `contactDb.import(ctx.tenantId, ...)`:

```ts
if (!ctx.isPlatformAdmin) {
  const gate = await canAddContacts(ctx.tenantId, contacts.length)
  if (!gate.allowed) return planLimitResponse('contacts', gate)
}
```
Mesmo import. Usar a contagem real do lote (`contacts.length`), para o import não ultrapassar o teto.

- [ ] **Step 3: Teste do gate (se houver `route.test.ts` da rota)**

`app/api/contacts/route.test.ts` existe? Se sim, adicionar caso: mock `canAddContacts` → `{ allowed:false, limit:100, current:100 }` e `getTenantContext` não-admin → espera 403 `plan_limit`. Se NÃO existir teste da rota, não criar suíte nova (lógica coberta em `lib/plan-limits.test.ts`); registrar no relatório que a checagem é manual.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` limpo; `npx vitest run` sem regressão.

- [ ] **Step 5: Commit**

```bash
git add app/api/contacts/route.ts app/api/contacts/import/route.ts
git commit -m "feat(3a): gate de plano em criar/importar contato"
```

---

### Task 4: Gate em criar template

**Files:**
- Modify: `app/api/templates/create/route.ts` (POST, ~linha 8)

- [ ] **Step 1: Aplicar o gate**

Após `const tenantId = ctx.tenantId` e antes de `templateService.create(tenantId, parsed)`:

```ts
if (!ctx.isPlatformAdmin) {
  const gate = await canCreateTemplate(tenantId)
  if (!gate.allowed) return planLimitResponse('templates', gate)
}
```
Import: `import { canCreateTemplate, planLimitResponse } from '@/lib/plan-limits'`.

- [ ] **Step 2: Teste** — se `app/api/templates/create/route.test.ts` existir, adicionar caso 403; senão, cobertura via `lib/plan-limits.test.ts` (registrar no relatório).

- [ ] **Step 3: Verificar** — `npx tsc --noEmit` limpo; `npx vitest run` sem regressão.

- [ ] **Step 4: Commit**

```bash
git add app/api/templates/create/route.ts
git commit -m "feat(3a): gate de plano em criar template"
```

---

### Task 5: Gate em criar campanha

**Files:**
- Modify: `app/api/campaigns/route.ts` (POST, ~linha 109)

- [ ] **Step 1: Aplicar o gate**

Após `if (!ctx?.tenantId) return ...401...` e antes de `const campaign = await campaignDb.create(ctx.tenantId, {...})`:

```ts
if (!ctx.isPlatformAdmin) {
  const gate = await canStartCampaign(ctx.tenantId)
  if (!gate.allowed) return planLimitResponse('campaigns', gate)
}
```
Import: `import { canStartCampaign, planLimitResponse } from '@/lib/plan-limits'`.

- [ ] **Step 2: Teste** — se `app/api/campaigns/route.test.ts` existir, adicionar caso 403; senão cobertura via `lib/plan-limits.test.ts` (registrar).

- [ ] **Step 3: Verificar** — `npx tsc --noEmit` limpo; `npx vitest run` sem regressão.

- [ ] **Step 4: Commit**

```bash
git add app/api/campaigns/route.ts
git commit -m "feat(3a): gate de plano em criar campanha (mês corrente)"
```

---

### Task 6: Gate em conectar número (reconexão-safe)

**Files:**
- Modify: `app/api/settings/credentials/route.ts` (POST, ~linha 96)

**Contexto:** hoje o fluxo salva 1 número por tenant via upsert (`onConflict: phone_number_id`); a UI de múltiplos números é a frente 4. O gate aqui NÃO pode bloquear a reconexão do número que o tenant já usa — só um número genuinamente novo além do limite. Como `canAddWhatsAppNumber` conta linhas de `whatsapp_phone_numbers` e o número atual já está lá, reconectar o mesmo mantém a contagem e, no limite 1, `current(1)+1 > 1` bloquearia indevidamente. Portanto: aplicar o gate SOMENTE quando o `phoneNumberId` recebido ainda não pertence ao tenant.

- [ ] **Step 1: Aplicar o gate condicional**

Após validar as credenciais com a Meta e antes de `settingsDb.saveAll(...)`/`upsertWhatsAppPhoneNumber(...)`:

```ts
if (!ctx.isPlatformAdmin) {
  const existingTenant = await resolveTenantByPhoneNumberId(phoneNumberId)
  const isNewNumber = existingTenant !== ctx.tenantId
  if (isNewNumber) {
    const gate = await canAddWhatsAppNumber(ctx.tenantId)
    if (!gate.allowed) return planLimitResponse('whatsapp_numbers', gate)
  }
}
```
Imports: `import { canAddWhatsAppNumber, planLimitResponse } from '@/lib/plan-limits'` e (se ainda não importado) `import { resolveTenantByPhoneNumberId } from '@/lib/whatsapp-phone-numbers'`.

- [ ] **Step 2: Verificar** — `npx tsc --noEmit` limpo; `npx vitest run` sem regressão (o teste existente de credentials não deve quebrar: com trial e nenhum número novo, o gate não dispara). Se o teste de credentials passar a exigir mock de `resolveTenantByPhoneNumberId`/`canAddWhatsAppNumber`, mockar retornando o próprio tenant / allowed.

- [ ] **Step 3: Commit**

```bash
git add app/api/settings/credentials/route.ts
git commit -m "feat(3a): gate de plano em conectar número (só número novo)"
```

---

### Task 7: Fechamento — suíte, build, runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-07-14-fase3a-planos.md`

- [ ] **Step 1: Suíte completa + build**

Run: `npx tsc --noEmit` → limpo; `npx vitest run` → 0 fail; `npm run build` → passa.

- [ ] **Step 2: Runbook**

Criar `docs/superpowers/runbooks/2026-07-14-fase3a-planos.md` com:
- Confirmar migração `plans` aplicada (3 planos, tenants todos com `plan_id`).
- Como trocar o plano de um tenant manualmente (até a tela da 3B):
  `UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE slug='pro'), trial_ends_at = NULL WHERE slug='<tenant-slug>';`
  (zerar `trial_ends_at` ao promover para plano pago tira o bloqueio de tempo da Fase 3.2).
- Como ajustar um limite:
  `UPDATE plans SET max_contacts = 10000 WHERE slug='basico';` (efeito imediato, sem deploy).
- Smoke test: com um tenant no trial (limite 3 templates), criar 3 templates OK e o 4º retornar 403 `plan_limit`; idem 100 contatos / 2 campanhas no mês.
- Nota: aplicação do limite de **números** só tem efeito prático quando a frente 4 permitir adicionar um segundo número; hoje o fluxo é upsert de 1.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/runbooks/2026-07-14-fase3a-planos.md
git commit -m "docs(3a): runbook — planos, troca manual e ajuste de limites"
```

---

## Notas de execução

- Ordem: 1 → 2 → (3, 4, 5, 6 em qualquer ordem, independentes entre si) → 7. Tasks 3–6 dependem da 2; a 2 depende da 1 (schema).
- A migração da Task 1 precisa ser aplicada no banco antes de qualquer gate rodar em produção (o gate lê `plans`/`tenants.plan_id`). O código falha fechado se a coluna faltar (trata como trial/zero), mas o correto é aplicar a migração no deploy.
- Tasks 3–6 são pequenas e mecânicas (poucas linhas por rota); a 2 é o núcleo lógico.
