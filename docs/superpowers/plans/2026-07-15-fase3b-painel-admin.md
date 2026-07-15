# Fase 3B — Painel de Administrador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel `/admin` (só platform_admin) para listar tenants com uso real vs limite, trocar plano, suspender/reativar, ver usuários, e editar limites dos planos — com autorização revalidada no servidor.

**Architecture:** Duas RPCs SECURITY DEFINER agregam a listagem e os usuários (gate `is_platform_admin` interno). Um helper `requirePlatformAdmin` centraliza o gate das rotas `/api/admin/*`. Páginas em `app/admin/*` (layout redireciona não-admin). Suspensão via `tenants.status='suspended'` + gate no layout do dashboard, reusando o padrão do trial (3.2).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + RPC), React Query, Vitest.

## Global Constraints

- Autorização real é server-side: TODA rota `/api/admin/*` revalida `isPlatformAdmin` → 403. Gate de UI é conveniência.
- Fail-closed: erro ao resolver contexto → não-admin (403/redirect). RPCs admin com `RAISE EXCEPTION` se não for admin (defesa em profundidade).
- Não alterar trial (3.2) nem gates de plano (3A). Suspensão é adicionada ao lado do gate de trial.
- Migrações versionadas em `supabase/migrations/` E aplicadas via MCP.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão (3486 passed).
- Branch: `saas/fase-3b-admin` a partir de `main`.

## Execução paralela (para o controller)
- Fundação (paralela): Task 1 (schema/RPCs) ∥ Task 2 (context+admin-auth).
- Rotas (paralela, após 1+2): Task 3 (tenants) ∥ Task 4 (plans).
- UI+gate (paralela, após 3+4): Task 5 (páginas /admin) ∥ Task 6 (gate suspensão).
- Fechamento: Task 7.

---

### Task 1: Schema — suspensão + RPCs de listagem e usuários

**Files:**
- Create: `supabase/migrations/20260715000001_admin_panel.sql`

**Interfaces:**
- Produces: coluna `tenants.suspended_at timestamptz`; RPC `admin_list_tenants()` e `admin_tenant_users(p_tenant_id uuid)` (ambas SECURITY DEFINER, gate is_platform_admin interno).

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260715000001_admin_panel.sql
-- Fase 3B: suspensão de tenant + RPCs do painel admin.
-- tenants.status já é text; valores usados: 'trialing' | 'active' | 'suspended'.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Lista agregada de tenants com uso vs limite (1 query, sem N+1). Só platform admin.
CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE (
  id uuid, name text, slug text, status text, trial_ends_at timestamptz, suspended_at timestamptz,
  plan_slug text, plan_name text,
  max_contacts integer, max_templates integer, max_campaigns_per_month integer, max_whatsapp_numbers integer,
  used_contacts bigint, used_templates bigint, used_campaigns_month bigint, used_whatsapp_numbers bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.status, t.trial_ends_at, t.suspended_at,
    p.slug, p.name, p.max_contacts, p.max_templates, p.max_campaigns_per_month, p.max_whatsapp_numbers,
    (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id),
    (SELECT count(*) FROM templates te WHERE te.tenant_id = t.id),
    (SELECT count(*) FROM campaigns ca WHERE ca.tenant_id = t.id AND ca.created_at >= date_trunc('month', now())),
    (SELECT count(*) FROM whatsapp_phone_numbers w WHERE w.tenant_id = t.id)
  FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
  ORDER BY t.created_at;
END; $$;

-- Usuários de um tenant (com e-mail de auth.users). Só platform admin.
CREATE OR REPLACE FUNCTION public.admin_tenant_users(p_tenant_id uuid)
RETURNS TABLE (user_id uuid, email text, role text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT tm.user_id, u.email::text, tm.role, tm.created_at
  FROM tenant_members tm JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id
  ORDER BY tm.created_at;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_list_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tenant_users(uuid) TO authenticated;
```

- [ ] **Step 2: Aplicar via MCP**

Aplicar via `mcp__supabase__apply_migration` (name `admin_panel`, mesmo SQL). Verificar: `SELECT count(*) FROM admin_list_tenants();` (rodando como service role no MCP a função ainda checa `is_platform_admin(auth.uid())` — `auth.uid()` é null no MCP, então vai lançar 'forbidden'; isso é ESPERADO e confirma o gate. Para verificar o corpo, testar via app após marcar um admin, ou temporariamente `SELECT` direto das tabelas.). Confirmar a coluna: `SELECT column_name FROM information_schema.columns WHERE table_name='tenants' AND column_name='suspended_at'` → 1 linha.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715000001_admin_panel.sql
git commit -m "feat(3b): migração — suspended_at + RPCs admin_list_tenants/admin_tenant_users"
```

---

### Task 2: `getTenantContext.suspended` + `lib/admin-auth.ts`

**Files:**
- Modify: `lib/tenant-context.ts`
- Create: `lib/admin-auth.ts`, `lib/admin-auth.test.ts`

**Interfaces:**
- Consumes: `getTenantContext` de `@/lib/tenant-context`.
- Produces: `TenantContext.suspended: boolean`; `requirePlatformAdmin(): Promise<{ ok: true; ctx: TenantContext } | { ok: false; response: NextResponse }>`.

- [ ] **Step 1: `TenantContext` ganha `suspended`**

Em `lib/tenant-context.ts`, adicionar `suspended: boolean` ao tipo e computar junto da leitura de tenant que já existe (para `trialExpired`). Arquivo resultante do bloco relevante:

```ts
export type TenantContext = {
  tenantId: string | null
  userId: string
  isPlatformAdmin: boolean
  trialExpired: boolean
  suspended: boolean
}
// ... dentro de getTenantContext, trocar a leitura de tenant:
  let trialExpired = false
  let suspended = false
  if (resolvedTenantId && !isAdmin) {
    const { data: tenantRow } = await supa
      .from('tenants').select('trial_ends_at, status').eq('id', resolvedTenantId).maybeSingle()
    trialExpired = isTrialExpired(tenantRow?.trial_ends_at ?? null)
    suspended = tenantRow?.status === 'suspended'
  }
  return { tenantId: resolvedTenantId, userId: user.id, isPlatformAdmin: !!isAdmin, trialExpired, suspended }
```
(Mocks de `getTenantContext` em testes existentes podem precisar de `suspended: false` — corrigir onde `tsc`/vitest apontar.)

- [ ] **Step 2: Teste de `requirePlatformAdmin`**

```ts
// lib/admin-auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))
import { requirePlatformAdmin } from '@/lib/admin-auth'

beforeEach(() => getTenantContext.mockReset())

it('admin passa', async () => {
  getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: true, trialExpired: false, suspended: false })
  const r = await requirePlatformAdmin()
  expect(r.ok).toBe(true)
})
it('não-admin → 403', async () => {
  getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false, trialExpired: false, suspended: false })
  const r = await requirePlatformAdmin()
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.response.status).toBe(403)
})
it('sem contexto → 403', async () => {
  getTenantContext.mockResolvedValue(null)
  const r = await requirePlatformAdmin()
  expect(r.ok).toBe(false)
})
```

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run lib/admin-auth.test.ts` → FAIL.

- [ ] **Step 4: Implementar**

```ts
// lib/admin-auth.ts
import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContext } from '@/lib/tenant-context'

export async function requirePlatformAdmin():
  Promise<{ ok: true; ctx: TenantContext } | { ok: false; response: NextResponse }> {
  let ctx: TenantContext | null = null
  try {
    ctx = await getTenantContext()
  } catch {
    ctx = null
  }
  if (!ctx?.isPlatformAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { ok: true, ctx }
}
```

- [ ] **Step 5: Rodar e ver passar** — `npx vitest run lib/admin-auth.test.ts` → PASS. `npx tsc --noEmit` → limpo.

- [ ] **Step 6: Commit**

```bash
git add lib/tenant-context.ts lib/admin-auth.ts lib/admin-auth.test.ts
git commit -m "feat(3b): TenantContext.suspended + requirePlatformAdmin"
```

---

### Task 3: Rotas `/api/admin/tenants`

**Files:**
- Create: `app/api/admin/tenants/route.ts` (GET), `app/api/admin/tenants/[id]/route.ts` (GET, PATCH)

**Interfaces:**
- Consumes: `requirePlatformAdmin` (Task 2); RPCs `admin_list_tenants`/`admin_tenant_users` (Task 1); `getSupabaseAdmin`.

- [ ] **Step 1: GET lista** — `app/api/admin/tenants/route.ts`

```ts
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const { data, error } = await db.rpc('admin_list_tenants')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tenants: data ?? [] })
}
```

- [ ] **Step 2: GET detalhe + PATCH** — `app/api/admin/tenants/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const [{ data: tenant }, { data: users }] = await Promise.all([
    db.from('tenants').select('id, name, slug, status, trial_ends_at, suspended_at, plan_id').eq('id', id).maybeSingle(),
    db.rpc('admin_tenant_users', { p_tenant_id: id }),
  ])
  if (!tenant) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ tenant, users: users ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const body = await req.json().catch(() => null)
  const update: Record<string, unknown> = {}

  if (typeof body?.planSlug === 'string') {
    const { data: plan } = await db.from('plans').select('id').eq('slug', body.planSlug).maybeSingle()
    if (!plan) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
    update.plan_id = plan.id
    if (body.planSlug !== 'trial') update.trial_ends_at = null // promover para pago tira o limite de tempo
  }
  if (typeof body?.status === 'string') {
    if (body.status === 'suspended') { update.status = 'suspended'; update.suspended_at = new Date().toISOString() }
    else if (body.status === 'active') { update.status = 'active'; update.suspended_at = null }
    else return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const { data, error } = await db.from('tenants').update(update).eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ tenant: data })
}
```

- [ ] **Step 3: Teste do gate** — `app/api/admin/tenants/route.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
const requireMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({ requirePlatformAdmin: () => requireMock() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ rpc: async () => ({ data: [], error: null }) }) }))
import { GET } from './route'
import { NextResponse } from 'next/server'

it('não-admin → 403', async () => {
  requireMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
  const res = await GET()
  expect(res.status).toBe(403)
})
it('admin → 200 com lista', async () => {
  requireMock.mockResolvedValue({ ok: true, ctx: {} })
  const res = await GET()
  expect(res.status).toBe(200)
})
```

- [ ] **Step 4: Verificar** — `npx vitest run app/api/admin/tenants/route.test.ts` → PASS. `npx tsc --noEmit` → limpo.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/tenants/
git commit -m "feat(3b): rotas /api/admin/tenants (lista, detalhe, patch plano/status)"
```

---

### Task 4: Rotas `/api/admin/plans`

**Files:**
- Create: `app/api/admin/plans/route.ts` (GET), `app/api/admin/plans/[id]/route.ts` (PATCH)

- [ ] **Step 1: GET lista** — `app/api/admin/plans/route.ts`

```ts
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const { data, error } = await db.from('plans').select('*').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data ?? [] })
}
```

- [ ] **Step 2: PATCH limites** — `app/api/admin/plans/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

const FIELDS = ['max_contacts', 'max_templates', 'max_campaigns_per_month', 'max_whatsapp_numbers'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const body = await req.json().catch(() => null)
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of FIELDS) {
    if (f in (body ?? {})) {
      const v = body[f]
      if (v === null) update[f] = null                         // ilimitado
      else if (Number.isInteger(v) && v >= 0) update[f] = v     // teto válido
      else return NextResponse.json({ error: `invalid_${f}` }, { status: 400 })
    }
  }
  if (Object.keys(update).length === 1) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
  const { data, error } = await db.from('plans').update(update).eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ plan: data })
}
```

- [ ] **Step 3: Teste do gate** — `app/api/admin/plans/route.test.ts` (mesma forma do Task 3: não-admin 403, admin 200).

- [ ] **Step 4: Verificar** — `npx vitest run app/api/admin/plans/route.test.ts` → PASS. `npx tsc --noEmit` → limpo.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/plans/
git commit -m "feat(3b): rotas /api/admin/plans (lista, patch limites)"
```

---

### Task 5: Páginas `/admin` + link no menu

**Files:**
- Create: `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/tenants/[id]/page.tsx`, `app/admin/plans/page.tsx`, `app/admin/AdminNav.tsx`
- Modify: `app/(dashboard)/DashboardShell.tsx` (link Admin no menu, só platform_admin)

**Interfaces:**
- Consumes: rotas `/api/admin/*` (Tasks 3, 4); `getTenantContext` (para o gate do layout).

- [ ] **Step 1: Layout com gate** — `app/admin/layout.tsx` (server component)

```tsx
import { redirect } from 'next/navigation'
import { getTenantContext } from '@/lib/tenant-context'
import { AdminNav } from './AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let ctx = null
  try { ctx = await getTenantContext() } catch { redirect('/login') }
  if (!ctx?.isPlatformAdmin) redirect('/')
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] text-[var(--ds-text-primary)]">
      <AdminNav />
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: `AdminNav.tsx`** — client, links `/admin` (Tenants) e `/admin/plans` (Planos), destaque no ativo (usar `usePathname`). Casca simples, classes do design system (`var(--ds-*)`).

- [ ] **Step 3: Lista de tenants** — `app/admin/page.tsx` (client): `useQuery` em `/api/admin/tenants`. Tabela: nome, plano, status (badge ativo/trial/suspenso), trial_ends_at, e uso vs limite por dimensão (ex.: `used_contacts/max_contacts`, mostrando "∞" quando o limite é null). Campo de busca por nome (filtro client-side). Cada linha linka para `/admin/tenants/[id]`.

- [ ] **Step 4: Detalhe do tenant** — `app/admin/tenants/[id]/page.tsx` (client): `useQuery` em `/api/admin/tenants/[id]`. Mostra dados + uso; um `<select>` de plano (trial/basico/pro) que ao mudar faz `PATCH {planSlug}`; botão Suspender/Reativar que faz `PATCH {status}` ('suspended'/'active'); tabela (leitura) de usuários (email, role, created_at). Invalida a query após cada ação. Usar `toast` (sonner, já no repo) para feedback.

- [ ] **Step 5: Editar planos** — `app/admin/plans/page.tsx` (client): `useQuery` em `/api/admin/plans`. Um card/form por plano com inputs numéricos para `max_contacts`, `max_templates`, `max_campaigns_per_month`, `max_whatsapp_numbers` (campo vazio = ilimitado → envia `null`). Botão Salvar → `PATCH /api/admin/plans/[id]`. Toast de sucesso; invalida query.

- [ ] **Step 6: Link no menu** — em `app/(dashboard)/DashboardShell.tsx`, adicionar ao `navItems` um item `{ path: '/admin', label: 'Admin', icon: Shield }` visível só para platform_admin. O DashboardShell é client e não tem o contexto server; obter `isPlatformAdmin` via `useQuery` num endpoint leve — usar o já existente `/api/auth/status` se ele expõe isPlatformAdmin; se não, criar `GET /api/admin/me` que retorna `{ isPlatformAdmin }` (via `requirePlatformAdmin` invertido: retorna 200 `{isPlatformAdmin:true}` para admin, 200 `{isPlatformAdmin:false}` senão — NÃO 403, pois todo usuário consulta). Ocultar o item com `hidden: !isPlatformAdmin` no filtro do `navItems`.

- [ ] **Step 7: Verificar** — `npx tsc --noEmit` limpo; `npm run build` passa (páginas novas compilam); `npx vitest run` sem regressão.

- [ ] **Step 8: Commit**

```bash
git add app/admin/ "app/(dashboard)/DashboardShell.tsx" app/api/admin/me/
git commit -m "feat(3b): páginas /admin (tenants, detalhe, planos) + link no menu"
```

---

### Task 6: Gate de suspensão + tela

**Files:**
- Modify: `app/(dashboard)/layout.tsx`, `proxy.ts`
- Create: `app/conta-suspensa/page.tsx`

**Interfaces:**
- Consumes: `getTenantContext().suspended` (Task 2).

- [ ] **Step 1: Gate no layout do dashboard** — `app/(dashboard)/layout.tsx`, adicionar a linha de suspensão ao lado do trial:

```tsx
  if (ctx?.suspended) redirect('/conta-suspensa')
  if (ctx?.trialExpired) redirect('/trial-expirado')
```
(suspensão antes do trial: um tenant suspenso vê a tela de suspensão mesmo que o trial também tenha vencido.)

- [ ] **Step 2: Tela** — `app/conta-suspensa/page.tsx` (server component, fora do shell, espelhando `app/trial-expirado/page.tsx`):

```tsx
export default function ContaSuspensaPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">Conta suspensa</h1>
        <p className="text-[var(--ds-text-secondary)] mt-3">
          Sua conta está temporariamente suspensa. Seus dados estão preservados. Fale com a gente para reativar.
        </p>
        <a href="mailto:contato@vozzyup.com.br?subject=Conta%20suspensa%20SmartZap"
           className="inline-block w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors">
          Falar com o time
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Proxy** — em `proxy.ts`, adicionar `/conta-suspensa` a `PUBLIC_PAGES` (alcançável pelo usuário logado-suspenso, sem loop de redirect).

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` limpo; `npx vitest run` sem regressão; `npm run build` passa.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/layout.tsx" app/conta-suspensa/ proxy.ts
git commit -m "feat(3b): gate de suspensão + tela /conta-suspensa"
```

---

### Task 7: Fechamento — suíte, build, runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-07-15-fase3b-admin.md`

- [ ] **Step 1: Suíte + build** — `npx tsc --noEmit` limpo; `npx vitest run` 0 fail; `npm run build` passa.

- [ ] **Step 2: Runbook** — criar `docs/superpowers/runbooks/2026-07-15-fase3b-admin.md`:
- Marcar o primeiro super-admin (necessário para acessar `/admin`). `is_platform_admin(uid)` consulta a tabela `platform_admins(user_id)`. Promover:
  ```sql
  INSERT INTO platform_admins (user_id)
  SELECT id FROM auth.users WHERE email = 'fernando.rodrigues.a@gmail.com'
  ON CONFLICT DO NOTHING;
  ```
  Conferir: `SELECT public.is_platform_admin((SELECT id FROM auth.users WHERE email='fernando.rodrigues.a@gmail.com'));` → true. (Aplicar via MCP no deploy.)
- Como suspender/reativar um tenant pela tela (`/admin` → tenant → Suspender) ou por SQL: `UPDATE tenants SET status='suspended', suspended_at=now() WHERE slug='<slug>'`.
- Smoke test: acessar `/admin` como admin (lista carrega com uso real); trocar plano de um tenant; suspender um tenant de teste e confirmar que ele cai em `/conta-suspensa`; reativar; editar um limite de plano e confirmar efeito.
- Nota: não-admin acessando `/admin` é redirecionado para `/`; rotas `/api/admin/*` retornam 403.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/runbooks/2026-07-15-fase3b-admin.md
git commit -m "docs(3b): runbook — admin, promover super-admin, suspensão"
```

---

## Notas de execução
- A promoção do primeiro platform_admin depende da definição de `is_platform_admin(uid)` — a Task 7 deve inspecionar a função e documentar o UPDATE correto. O controller pode aplicar via MCP no deploy.
- RPCs admin usam `auth.uid()` — funcionam com a sessão do usuário (via app), não no MCP anônimo. Testar o corpo via app após promover um admin.
