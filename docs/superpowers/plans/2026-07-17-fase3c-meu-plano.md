# Fase 3C — Meu Plano (usuário final) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao cliente visibilidade do próprio plano (card no dashboard + página `/settings/plano` com uso vs limite, trial e comparativo com preço) e traduzir o 403 `plan_limit` numa mensagem amigável com caminho de upgrade via WhatsApp.

**Architecture:** Reaproveita `lib/plan-limits` (getTenantPlan + contagem) num novo `lib/plan-usage` (snapshot de uso do tenant). Rotas `GET /api/plan` e `GET /api/plans/catalog` alimentam a UI. Preço vive em `plans.price_cents` (editável pelo `/admin`). Um helper `formatPlanLimit` traduz o erro de limite, usado nos handlers client via toast.

**Tech Stack:** Next.js 16 App Router, Supabase, React Query, sonner (toast), Vitest.

## Global Constraints

- Server-side resolve tenant via `getTenantContext` → 401 sem sessão. Nunca vaza plano/uso de outro tenant.
- Reusar `lib/plan-limits` para contagem — não duplicar lógica.
- Não alterar gates (3A) nem admin (3B) além de adicionar `price_cents` ao PATCH existente.
- Preço: `plans.price_cents` integer nullable (centavos BRL). Exibe "R$ X,XX/mês"; `NULL` = "Grátis" (trial) ou "Sob consulta".
- Limite `NULL` = ilimitado ("∞"). Contato upgrade: `https://wa.me/5511976194739`.
- Migração versionada em `supabase/migrations/` E aplicada via MCP.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-3c-meu-plano` a partir de `main`.

## Execução paralela (para o controller)
- Fundação (paralela): Task 1 (schema+admin preço) ∥ Task 2 (plan-usage) ∥ Task 3 (message helper).
- Rotas (após 2): Task 4.
- UI (após 4) ∥ Mensagem nos handlers (após 3): Task 5 ∥ Task 6.
- Fechamento: Task 7.

---

### Task 1: Preço no schema + admin (PATCH + UI)

**Files:**
- Create: `supabase/migrations/20260717000001_plan_price.sql`
- Modify: `app/api/admin/plans/[id]/route.ts`, `app/admin/plans/page.tsx`

**Interfaces:**
- Produces: coluna `plans.price_cents integer`; PATCH admin aceita `price_cents` (int ≥ 0 ou null); UI de preço no admin.

- [ ] **Step 1: Migração**

```sql
-- supabase/migrations/20260717000001_plan_price.sql
-- Fase 3C: preço mensal do plano (centavos BRL). NULL = grátis/sob consulta.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS price_cents integer;
```

- [ ] **Step 2: Aplicar via MCP** — `mcp__supabase__apply_migration` (name `plan_price`). Verificar: `SELECT column_name FROM information_schema.columns WHERE table_name='plans' AND column_name='price_cents'` → 1 linha.

- [ ] **Step 3: PATCH admin aceita price_cents**

Em `app/api/admin/plans/[id]/route.ts`, adicionar `'price_cents'` ao array `FIELDS`:
```ts
const FIELDS = ['max_contacts', 'max_templates', 'max_campaigns_per_month', 'max_whatsapp_numbers', 'price_cents'] as const
```
(A validação existente já aceita `null` ou inteiro ≥ 0 — `price_cents` se encaixa.)

- [ ] **Step 4: UI de preço no admin**

Em `app/admin/plans/page.tsx`, adicionar ao form de cada plano um input de preço **em reais** (ex.: "49,90") que ao salvar converte para centavos: `price_cents = Math.round(parseFloat(valor.replace(',', '.')) * 100)` (campo vazio → `null`). Exibir o valor atual dividindo por 100. Enviar `price_cents` no `PATCH /api/admin/plans/[id]`. Seguir o padrão dos inputs de limite já existentes no arquivo.

- [ ] **Step 5: Verificar** — `npx tsc --noEmit` limpo; se houver `app/api/admin/plans/[id]/route.test.ts`, adicionar caso `price_cents` inválido → 400 e válido → 200.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260717000001_plan_price.sql app/api/admin/plans/ app/admin/plans/page.tsx
git commit -m "feat(3c): plans.price_cents + preço editável no /admin"
```

---

### Task 2: `lib/plan-usage.ts` + contagem reutilizável (TDD)

**Files:**
- Modify: `lib/plan-limits.ts` (exportar helper de contagem)
- Create: `lib/plan-usage.ts`, `lib/plan-usage.test.ts`

**Interfaces:**
- Consumes: `getTenantPlan`, `Plan` de `@/lib/plan-limits`.
- Produces:
  - Em `lib/plan-limits.ts`: `export async function getUsageCounts(tenantId: string): Promise<{ contacts: number; templates: number; campaignsMonth: number; whatsappNumbers: number }>` — usa a função interna `countRows` para as 4 dimensões (campaignsMonth com `thisMonth=true`). Fail-safe embutido (countRows já retorna MAX_SAFE_INTEGER em erro — para *usage* trocar por 0 no catch do próprio getUsageCounts para não exibir número absurdo na UI; ver nota abaixo).
  - Em `lib/plan-usage.ts`:
    - `type UsageDimension = { used: number; limit: number | null }`
    - `type PlanUsage = { plan: { slug: string; name: string; price_cents: number | null }; usage: { contacts: UsageDimension; templates: UsageDimension; campaignsMonth: UsageDimension; whatsappNumbers: UsageDimension }; trial: { endsAt: string | null; daysLeft: number | null } }`
    - `getPlanUsage(tenantId: string): Promise<PlanUsage>`

Nota fail-safe: em *usage* (exibição), um erro de contagem deve mostrar `used: 0` (não bloquear/assustar), diferente do gate (que bloqueia). Por isso `getUsageCounts` tem seu próprio try/catch retornando 0.

- [ ] **Step 1: Exportar contagem reutilizável em `lib/plan-limits.ts`**

Adicionar (reutiliza `countRows` já existente no arquivo):
```ts
export async function getUsageCounts(tenantId: string): Promise<{ contacts: number; templates: number; campaignsMonth: number; whatsappNumbers: number }> {
  try {
    const [contacts, templates, campaignsMonth, whatsappNumbers] = await Promise.all([
      countRows('contacts', tenantId),
      countRows('templates', tenantId),
      countRows('campaigns', tenantId, true),
      countRows('whatsapp_phone_numbers', tenantId),
    ])
    // countRows retorna MAX_SAFE_INTEGER em erro (fail-closed p/ gate);
    // para exibição, normaliza número irreal para 0.
    const norm = (n: number) => (n >= Number.MAX_SAFE_INTEGER ? 0 : n)
    return { contacts: norm(contacts), templates: norm(templates), campaignsMonth: norm(campaignsMonth), whatsappNumbers: norm(whatsappNumbers) }
  } catch {
    return { contacts: 0, templates: 0, campaignsMonth: 0, whatsappNumbers: 0 }
  }
}
```

- [ ] **Step 2: Teste que falha — `lib/plan-usage.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const getTenantPlan = vi.fn()
const getUsageCounts = vi.fn()
vi.mock('@/lib/plan-limits', () => ({
  getTenantPlan: (...a: any[]) => getTenantPlan(...a),
  getUsageCounts: (...a: any[]) => getUsageCounts(...a),
}))
const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}))
import { getPlanUsage } from '@/lib/plan-usage'

const PLAN = { id: 'p', slug: 'trial', name: 'Trial', price_cents: null, max_contacts: 100, max_templates: 3, max_campaigns_per_month: 2, max_whatsapp_numbers: 1 }

beforeEach(() => { getTenantPlan.mockReset(); getUsageCounts.mockReset(); maybeSingle.mockReset() })

it('monta uso vs limite por dimensão', async () => {
  getTenantPlan.mockResolvedValue(PLAN)
  getUsageCounts.mockResolvedValue({ contacts: 40, templates: 3, campaignsMonth: 1, whatsappNumbers: 1 })
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: null } })
  const r = await getPlanUsage('t1')
  expect(r.plan.slug).toBe('trial')
  expect(r.usage.contacts).toEqual({ used: 40, limit: 100 })
  expect(r.usage.templates).toEqual({ used: 3, limit: 3 })
})

it('limite null vira ilimitado', async () => {
  getTenantPlan.mockResolvedValue({ ...PLAN, slug: 'pro', name: 'Pro', max_templates: null })
  getUsageCounts.mockResolvedValue({ contacts: 5, templates: 999, campaignsMonth: 0, whatsappNumbers: 1 })
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: null } })
  const r = await getPlanUsage('t1')
  expect(r.usage.templates).toEqual({ used: 999, limit: null })
})

it('trial daysLeft calculado (futuro)', async () => {
  getTenantPlan.mockResolvedValue(PLAN)
  getUsageCounts.mockResolvedValue({ contacts: 0, templates: 0, campaignsMonth: 0, whatsappNumbers: 0 })
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60_000).toISOString()
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: future } })
  const r = await getPlanUsage('t1')
  expect(r.trial.daysLeft).toBe(3) // ceil de ~2 dias
})

it('sem trial → daysLeft null', async () => {
  getTenantPlan.mockResolvedValue(PLAN)
  getUsageCounts.mockResolvedValue({ contacts: 0, templates: 0, campaignsMonth: 0, whatsappNumbers: 0 })
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: null } })
  const r = await getPlanUsage('t1')
  expect(r.trial.daysLeft).toBeNull()
})
```

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run lib/plan-usage.test.ts` → FAIL.

- [ ] **Step 4: Implementar `lib/plan-usage.ts`**

```ts
import { getSupabaseAdmin } from '@/lib/supabase'
import { getTenantPlan, getUsageCounts } from '@/lib/plan-limits'

export type UsageDimension = { used: number; limit: number | null }
export type PlanUsage = {
  plan: { slug: string; name: string; price_cents: number | null }
  usage: { contacts: UsageDimension; templates: UsageDimension; campaignsMonth: UsageDimension; whatsappNumbers: UsageDimension }
  trial: { endsAt: string | null; daysLeft: number | null }
}

function daysLeft(endsAt: string | null): number | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export async function getPlanUsage(tenantId: string): Promise<PlanUsage> {
  const [plan, counts] = await Promise.all([getTenantPlan(tenantId), getUsageCounts(tenantId)])
  let endsAt: string | null = null
  try {
    const db = getSupabaseAdmin()
    if (db) {
      const { data } = await db.from('tenants').select('trial_ends_at').eq('id', tenantId).maybeSingle()
      endsAt = (data as { trial_ends_at?: string } | null)?.trial_ends_at ?? null
    }
  } catch { endsAt = null }

  return {
    plan: { slug: plan.slug, name: plan.name, price_cents: (plan as { price_cents?: number | null }).price_cents ?? null },
    usage: {
      contacts: { used: counts.contacts, limit: plan.max_contacts },
      templates: { used: counts.templates, limit: plan.max_templates },
      campaignsMonth: { used: counts.campaignsMonth, limit: plan.max_campaigns_per_month },
      whatsappNumbers: { used: counts.whatsappNumbers, limit: plan.max_whatsapp_numbers },
    },
    trial: { endsAt, daysLeft: daysLeft(endsAt) },
  }
}
```

> Nota: `getTenantPlan` retorna `Plan` sem `price_cents` no tipo atual. Estender o tipo `Plan` em `lib/plan-limits.ts` para incluir `price_cents: number | null` e adicionar `price_cents` à lista de colunas lidas (`PLAN_COLS`), para o snapshot ter o preço sem query extra. (Faz parte desta task.)

- [ ] **Step 5: Rodar e ver passar** — `npx vitest run lib/plan-usage.test.ts` → PASS. `npx tsc --noEmit` limpo.

- [ ] **Step 6: Commit**

```bash
git add lib/plan-limits.ts lib/plan-usage.ts lib/plan-usage.test.ts
git commit -m "feat(3c): getUsageCounts + lib/plan-usage (snapshot de uso do tenant)"
```

---

### Task 3: `lib/plan-limit-message.ts` (TDD)

**Files:**
- Create: `lib/plan-limit-message.ts`, `lib/plan-limit-message.test.ts`

**Interfaces:**
- Produces: `formatPlanLimit(body: { error?: string; dimension?: string; limit?: number | null; current?: number }): string`.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest'
import { formatPlanLimit } from '@/lib/plan-limit-message'

it('traduz cada dimensão', () => {
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'templates', limit: 3, current: 3 }))
    .toBe('Seu plano permite até 3 templates. Faça upgrade para criar mais.')
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'contacts', limit: 100, current: 100 }))
    .toContain('100 contatos')
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'campaigns', limit: 2, current: 2 }))
    .toContain('2 campanhas por mês')
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'whatsapp_numbers', limit: 1, current: 1 }))
    .toContain('1 número de WhatsApp')
})

it('dimensão desconhecida → fallback genérico', () => {
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'xyz', limit: 5, current: 5 }))
    .toBe('Você atingiu o limite do seu plano. Faça upgrade para continuar.')
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/plan-limit-message.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// lib/plan-limit-message.ts
const LABELS: Record<string, string> = {
  contacts: 'contatos',
  templates: 'templates',
  campaigns: 'campanhas por mês',
  whatsapp_numbers: 'número de WhatsApp',
}

export function formatPlanLimit(body: { error?: string; dimension?: string; limit?: number | null; current?: number }): string {
  const label = body.dimension ? LABELS[body.dimension] : undefined
  if (!label || body.limit == null) {
    return 'Você atingiu o limite do seu plano. Faça upgrade para continuar.'
  }
  const plural = body.limit === 1 ? label.replace('números', 'número') : label
  return `Seu plano permite até ${body.limit} ${plural}. Faça upgrade para criar mais.`
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run lib/plan-limit-message.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-limit-message.ts lib/plan-limit-message.test.ts
git commit -m "feat(3c): formatPlanLimit — mensagem amigável de limite de plano"
```

---

### Task 4: Rotas `GET /api/plan` e `GET /api/plans/catalog`

**Files:**
- Create: `app/api/plan/route.ts`, `app/api/plans/catalog/route.ts`, `app/api/plan/route.test.ts`

**Interfaces:**
- Consumes: `getPlanUsage` (Task 2), `getTenantContext`, `getSupabaseAdmin`.
- Produces: `GET /api/plan` → `{ ...PlanUsage }`; `GET /api/plans/catalog` → `{ plans: Array<{ slug, name, price_cents, max_contacts, max_templates, max_campaigns_per_month, max_whatsapp_numbers }> }`.

- [ ] **Step 1: `app/api/plan/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getPlanUsage } from '@/lib/plan-usage'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const data = await getPlanUsage(ctx.tenantId)
  return NextResponse.json(data)
}
```

- [ ] **Step 2: `app/api/plans/catalog/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ plans: [] })
  const { data } = await db
    .from('plans')
    .select('slug, name, price_cents, max_contacts, max_templates, max_campaigns_per_month, max_whatsapp_numbers')
    .eq('is_active', true)
    .order('sort_order')
  return NextResponse.json({ plans: data ?? [] })
}
```

- [ ] **Step 3: Teste — `app/api/plan/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const getTenantContext = vi.fn()
const getPlanUsage = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))
vi.mock('@/lib/plan-usage', () => ({ getPlanUsage: (...a: any[]) => getPlanUsage(...a) }))
import { GET } from './route'

beforeEach(() => { getTenantContext.mockReset(); getPlanUsage.mockReset() })

it('sem sessão → 401', async () => {
  getTenantContext.mockResolvedValue(null)
  const res = await GET()
  expect(res.status).toBe(401)
})
it('com tenant → 200 com uso', async () => {
  getTenantContext.mockResolvedValue({ tenantId: 't1', isPlatformAdmin: false })
  getPlanUsage.mockResolvedValue({ plan: { slug: 'trial' }, usage: {}, trial: {} })
  const res = await GET()
  expect(res.status).toBe(200)
  expect((await res.json()).plan.slug).toBe('trial')
})
```

- [ ] **Step 4: Verificar** — `npx vitest run app/api/plan/route.test.ts` → PASS. `npx tsc --noEmit` limpo.

- [ ] **Step 5: Commit**

```bash
git add app/api/plan/ app/api/plans/
git commit -m "feat(3c): rotas GET /api/plan e /api/plans/catalog"
```

---

### Task 5: UI — página `/settings/plano` + card no dashboard + menu

**Files:**
- Create: `app/(dashboard)/settings/plano/page.tsx`, `components/features/plan/PlanUsageBars.tsx`, `components/features/plan/PlanComparison.tsx`, `components/features/dashboard/PlanUsageCard.tsx`
- Modify: `app/(dashboard)/DashboardShell.tsx` (item de menu + card no dashboard, se o dashboard é renderizado aqui) OU a página do dashboard

**Interfaces:**
- Consumes: `GET /api/plan`, `GET /api/plans/catalog` (Task 4).

- [ ] **Step 1: Componentes de exibição**

`PlanUsageBars.tsx` (client) — recebe `usage` do `/api/plan`; renderiza uma linha por dimensão (Contatos, Templates, Campanhas no mês, Números de WhatsApp): rótulo, `used/limit` ("∞" quando `limit===null`), e uma barra de progresso (largura `used/limit*100`, cor de alerta quando `≥90%`; ilimitado mostra barra neutra). Usar classes do design system `var(--ds-*)`.

`PlanComparison.tsx` (client) — recebe `plans` do catálogo e o `slug` atual; renderiza os 3 planos em cards com nome, preço (`price_cents` → "R$ X,XX/mês", `null` → "Grátis" se slug==='trial' senão "Sob consulta"), e os limites (∞ quando null). Destaca o plano atual. Botão "Falar com o time" (em todos exceto o atual, ou global) → link `https://wa.me/5511976194739?text=${encodeURIComponent('Olá! Quero fazer upgrade do meu plano no SmartZap.')}` (target _blank).

- [ ] **Step 2: Página `/settings/plano`**

`app/(dashboard)/settings/plano/page.tsx` — pode ser client component consumindo as duas rotas via `useQuery` (React Query). Estrutura: cabeçalho com plano atual + preço; se `trial.daysLeft != null`, badge "Trial — {daysLeft} dias restantes"; `<PlanUsageBars usage={...} />`; `<PlanComparison plans={...} currentSlug={...} />`. Layout mobile-friendly (evitar altura fixa; deixar a página fluir — mesma lição da tela de contatos).

- [ ] **Step 3: Card no dashboard**

`components/features/dashboard/PlanUsageCard.tsx` (client) — `useQuery` em `/api/plan`; mostra o nome do plano, e OU "Trial — N dias" (se em trial) OU a dimensão com maior `used/limit` (ex.: "Contatos 87/100") com uma barrinha; link "Ver meu plano" → `/settings/plano`. Incluir esse card no dashboard (localizar o grid de cards do dashboard — provável em `app/(dashboard)/page.tsx` ou um componente de dashboard; adicionar o card ao layout existente).

- [ ] **Step 4: Menu**

Em `app/(dashboard)/DashboardShell.tsx`, adicionar ao `navItems` (ou ao submenu de Configurações, conforme o padrão) um item `{ path: '/settings/plano', label: 'Meu Plano', icon: <ícone lucide, ex. CreditCard> }`, visível a todos os usuários logados. Adicionar o título em `getPageTitle` (`/settings/plano` → 'Meu Plano').

- [ ] **Step 5: Verificar** — `npx tsc --noEmit` limpo; `npm run build` passa; `npx vitest run` sem regressão.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/settings/plano/" components/features/plan/ components/features/dashboard/PlanUsageCard.tsx "app/(dashboard)/DashboardShell.tsx"
git commit -m "feat(3c): página /settings/plano + card no dashboard + menu Meu Plano"
```

---

### Task 6: Mensagem amigável nos handlers client

**Files:**
- Modify: os pontos client que chamam as rotas com gate de plano e hoje mostram erro cru. Localizar os handlers de: criar contato / importar (`hooks/useContacts.ts` ou `services/contactService.ts`), criar template, criar campanha, conectar número. Onde o toast de erro é disparado.

**Interfaces:**
- Consumes: `formatPlanLimit` (Task 3).

- [ ] **Step 1: Helper de tratamento**

Onde as mutações tratam erro de resposta, detectar o 403 `plan_limit` e trocar a mensagem. Padrão (aplicar em cada mutação relevante):
```ts
import { formatPlanLimit } from '@/lib/plan-limit-message'
import { toast } from 'sonner'
// no catch/onError, quando a resposta for 403 com body.error === 'plan_limit':
toast.error(formatPlanLimit(body), {
  action: { label: 'Ver meu plano', onClick: () => { window.location.href = '/settings/plano' } },
})
```
Localizar cada ponto: buscar onde `contactService.add`/`import`, criação de template, criação de campanha e conexão de número tratam erro. Se houver um wrapper central de fetch (ex.: `lib/api-client`/`services/*`), tratar lá o `plan_limit` uma vez e propagar; senão, tratar em cada mutação. Não duplicar além do necessário.

- [ ] **Step 2: Verificar** — `npx tsc --noEmit` limpo; `npx vitest run` sem regressão. (Testes de UI não exigidos; a lógica de mensagem está coberta em `lib/plan-limit-message.test.ts`.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(3c): toast amigável de limite de plano com link para Meu Plano"
```
(Commitar apenas os arquivos tocados — usar `git commit -- <paths>` se em execução paralela.)

---

### Task 7: Fechamento — suíte, build, runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-07-17-fase3c-meu-plano.md`

- [ ] **Step 1: Suíte + build** — `npx tsc --noEmit` limpo; `npx vitest run` 0 fail; `npm run build` passa.

- [ ] **Step 2: Runbook** — criar com: confirmar migração `price_cents` aplicada; definir os preços via `/admin/plans` (Básico e Pro; Trial fica NULL=Grátis); smoke test — abrir `/settings/plano` como cliente (uso vs limite corretos, trial dias, comparativo com preço), estourar um limite (ex.: 4º template no trial) e ver o toast amigável + link, clicar em "Falar com o time" e confirmar que abre o WhatsApp `5511976194739`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/runbooks/2026-07-17-fase3c-meu-plano.md
git commit -m "docs(3c): runbook — Meu Plano, definir preços, smoke test"
```

---

## Notas de execução
- Ordem: 1 ∥ 2 ∥ 3 (fundação) → 4 (depende de 2) → 5 ∥ 6 (5 depende de 4; 6 depende de 3) → 7.
- Task 2 estende o tipo `Plan` e `PLAN_COLS` em `lib/plan-limits.ts` para incluir `price_cents` — atenção para não conflitar com Task 1 (que só toca migração + admin route + admin page, arquivos disjuntos de `lib/plan-limits.ts`).
- A migração da Task 1 deve ser aplicada no banco antes da Task 2 rodar contra dados reais (mas os testes mockam, então a ordem de código é livre; só o deploy exige a coluna).
