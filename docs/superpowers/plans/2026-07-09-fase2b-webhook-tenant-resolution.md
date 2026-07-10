# Fase 2B — Resolução de Tenant em Webhooks + Fix do Workflow Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Destravar o webhook do Meta WhatsApp, o webhook do Google Calendar e o endpoint de WhatsApp Flows (todos bloqueados por `resolveWebhookTenantId()`, guard intencional da Fase 2A), e corrigir o workflow builder visual para operar de forma tenant-scoped — incluindo dois bugs adicionais achados durante o planejamento (vazamento cross-tenant real em `fetchWorkflowRecord`/`listWorkflowRecords`, e `webhook_verify_token` modelado incorretamente como per-tenant quando é um valor de configuração de plataforma).

**Architecture:** Dois padrões de resolução de tenant sem sessão, escolhidos por task na Fase 2A e no brainstorming desta fase: (a) tabelas de mapeamento dedicadas (`whatsapp_phone_numbers`, `google_calendar_channels`) para webhooks cujo payload/header carrega um identificador externo; (b) URL por tenant (token opaco no path) para o endpoint de WhatsApp Flows, que precisa da chave privada do tenant *antes* de conseguir decifrar o payload e portanto não tem identificador disponível pós-decriptação. O workflow builder deriva tenant do próprio recurso (`workflows.tenant_id`) nos handlers sem sessão, e via `getTenantContext()` nas rotas com sessão — mesmo padrão consolidado na Fase 2A.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), TypeScript, Vitest, Upstash Workflow (`serve()`).

## Global Constraints

- Toda tabela nova: `enable row level security`; policy `to authenticated using (tenant_id = (select current_tenant_id()) or (select is_platform_admin((select auth.uid()))))`; se houver função `SECURITY DEFINER`, `revoke execute ... from public, anon;`.
- SQL: iterar com `mcp__supabase__execute_sql`; `mcp__supabase__get_advisors` (security + performance) depois de aplicar; salvar migração final em `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`. Nunca usar `apply_migration` durante iteração.
- `phone_number_id`, `channel_token`, `flows_webhook_token` são `primary key`/`unique` — upsert por um novo tenant transfere a posse (comportamento desejado, não é bug).
- Testes: Vitest. Baseline atual (HEAD da branch `saas/fase-2-multitenancy` pós-Fase 2A): `npx tsc --noEmit` limpo, `npx vitest run` = 3430 passed, 4 skipped. Cada task roda a suíte completa antes de commitar e não pode introduzir regressão.
- Branch: continua em `saas/fase-2-multitenancy`.
- `app/api/webhook/route.ts` já tem `export const runtime = 'nodejs'` — manter.
- Convenção de tenant-scoping já usada em toda a Fase 2A: `tenantId` é o primeiro argumento "de negócio" de qualquer função `*Db`/helper que hoje é global (depois do client Supabase explícito, se houver um).
- Ferramenta admin `lib/mcp/tools/system.ts:219` **não é tocada** nesta fase — é stress-test sintético sem tenant real, permanece bloqueada por `resolveWebhookTenantId()` (decisão do spec).

---

## Estrutura de arquivos

**Novas migrações SQL** (`supabase/migrations/`):
- `20260709000001_multitenancy_webhook_tenant_mapping.sql` — cria `whatsapp_phone_numbers` (com coluna `flows_webhook_token`) e `google_calendar_channels`.

**Novos arquivos:**
- `lib/whatsapp-phone-numbers.ts` — CRUD de `whatsapp_phone_numbers` (upsert por `phone_number_id`, lookup por `phone_number_id`/`flows_webhook_token`, geração/persistência do `flows_webhook_token`).
- `lib/whatsapp-phone-numbers.test.ts`
- `app/api/flows/endpoint/[token]/route.ts` — substitui `app/api/flows/endpoint/route.ts`.

**Modificar:**
- `app/api/settings/credentials/route.ts` — write-through em `whatsapp_phone_numbers` no POST/DELETE.
- `lib/google-calendar.ts` — write-through em `saveCalendarChannel`.
- `app/api/webhook/route.ts` — POST resolve tenant por `phone_number_id`; GET não depende mais de tenant (verify token vira platform-level).
- `lib/verify-token.ts` — perde o parâmetro `tenantId`, passa a usar `platformSettingsDb`.
- `app/api/meta/diagnostics/route.ts`, `app/api/meta/webhooks/subscription/route.ts`, `app/api/phone-numbers/[phoneNumberId]/webhook/override/route.ts`, `app/api/webhook/info/route.ts`, `app/api/webhook/validate/route.ts` — param a menos em `getVerifyToken(...)`.
- `app/api/integrations/google-calendar/webhook/route.ts` — resolve tenant por `channel_token`.
- `app/api/flows/endpoint/keys/route.ts`, `app/api/flows/endpoint/test/route.ts`, `app/api/flows/[id]/meta/publish/route.ts` — URL do endpoint passa a incluir o token.
- `lib/whatsapp/flow-endpoint-handlers.ts` — `handleFlowAction`, `handleDataExchange`, `handleInit`, `handleBack` ganham `tenantId` como parâmetro.
- `lib/builder/workflow-db.ts` — `ensureWorkflowRecord`, `createWorkflowRecord`, `updateWorkflowRecord`, `getCompanyId`, `fetchWorkflowRecord`, `listWorkflowRecords`, `createNewVersion` ganham `tenantId`.
- 11 rotas em `app/api/builder/workflows/**` — passam a resolver `tenantId` via `getTenantContext()` e propagar aos helpers de `workflow-db.ts`.
- `app/api/builder/workflow/[workflowId]/execute/route.ts`, `app/api/builder/workflow/[workflowId]/resume/route.ts` — derivam `tenantId` de `workflows.tenant_id`, não de sessão/payload.

---

### Task 1: Migração SQL — tabelas de mapeamento tenant

**Files:**
- Create: `supabase/migrations/20260709000001_multitenancy_webhook_tenant_mapping.sql`

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.current_tenant_id()`, `public.is_platform_admin(uuid)` (Fase 2A).
- Produces: `public.whatsapp_phone_numbers(phone_number_id, tenant_id, business_account_id, flows_webhook_token, created_at, updated_at)`; `public.google_calendar_channels(channel_token, tenant_id, channel_id, resource_id, created_at, updated_at)`.

- [ ] **Step 1: Escrever e aplicar a migração via `mcp__supabase__execute_sql`**

```sql
begin;

create table if not exists public.whatsapp_phone_numbers (
  phone_number_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_account_id text,
  flows_webhook_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_phone_numbers_tenant_id
  on public.whatsapp_phone_numbers(tenant_id);

create table if not exists public.google_calendar_channels (
  channel_token text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id text,
  resource_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_google_calendar_channels_tenant_id
  on public.google_calendar_channels(tenant_id);

alter table public.whatsapp_phone_numbers enable row level security;
alter table public.google_calendar_channels enable row level security;

create policy "whatsapp_phone_numbers own tenant" on public.whatsapp_phone_numbers
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "google_calendar_channels own tenant" on public.google_calendar_channels
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

commit;
```

- [ ] **Step 2: `mcp__supabase__get_advisors` (security + performance)**

Corrigir qualquer finding sobre as 2 tabelas novas. Findings sobre as 38 tabelas de domínio já existentes não são desta task.

- [ ] **Step 3: Smoke test via `execute_sql`**

```sql
begin;
with t1 as (insert into public.tenants(name, slug) values ('smoke-a','smoke-a') returning id),
     t2 as (insert into public.tenants(name, slug) values ('smoke-b','smoke-b') returning id)
insert into public.whatsapp_phone_numbers(phone_number_id, tenant_id)
select 'pn_smoke_123', id from t1;

select (select count(*) from public.whatsapp_phone_numbers) as service_ve;

set local role authenticated;
select (select count(*) from public.whatsapp_phone_numbers) as authenticated_sem_tenant_ve;
```

Expected: `service_ve = 1`, `authenticated_sem_tenant_ve = 0` (RLS nega, sem `tenant_members`). Rodar dentro de uma transação e `rollback` no final para não deixar dados de teste.

- [ ] **Step 4: Salvar a migração e commitar**

O SQL do Step 1 (já validado e sem findings) é o conteúdo final do arquivo criado no Step 1 — apenas confirme que está salvo em disco.

```bash
git add supabase/migrations/20260709000001_multitenancy_webhook_tenant_mapping.sql
git commit -m "feat(2B): tabelas whatsapp_phone_numbers e google_calendar_channels (mapeamento tenant p/ webhooks)"
```

---

### Task 2: `lib/whatsapp-phone-numbers.ts` — CRUD + geração de flows_webhook_token (TDD)

**Files:**
- Create: `lib/whatsapp-phone-numbers.ts`, `lib/whatsapp-phone-numbers.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` (`lib/supabase.ts`), tabela `whatsapp_phone_numbers` (Task 1).
- Produces:
  - `upsertWhatsAppPhoneNumber(tenantId: string, params: { phoneNumberId: string; businessAccountId?: string | null }): Promise<void>`
  - `resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null>`
  - `resolveTenantByFlowsWebhookToken(token: string): Promise<string | null>`
  - `getOrCreateFlowsWebhookToken(tenantId: string): Promise<string>` — busca a linha do tenant; se não existir `flows_webhook_token`, gera com `fwh_${crypto.randomUUID().replace(/-/g,'')}` e persiste via `update`. Se a linha do tenant também não existir ainda (nunca salvou `phoneNumberId`), lança erro claro — token de Flows depende de já ter uma linha (que é criada no write-through de credenciais, Task 3).
  - `clearWhatsAppPhoneNumber(tenantId: string): Promise<void>` — remove a linha do tenant (usado no DELETE de credenciais).

- [ ] **Step 1: Escrever os testes (falhando)**

```typescript
// lib/whatsapp-phone-numbers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsertFn = vi.fn()
const selectByPhoneFn = vi.fn()
const selectByTokenFn = vi.fn()
const selectByTenantFn = vi.fn()
const updateFn = vi.fn()
const deleteFn = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'whatsapp_phone_numbers') throw new Error(`unexpected table ${table}`)
      return {
        upsert: (row: any, opts: any) => ({ error: null, ...upsertFn(row, opts) }),
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: () =>
              col === 'phone_number_id' ? selectByPhoneFn(val)
              : col === 'flows_webhook_token' ? selectByTokenFn(val)
              : selectByTenantFn(val),
          }),
        }),
        update: (patch: any) => ({ eq: () => updateFn(patch) }),
        delete: () => ({ eq: () => deleteFn() }),
      }
    },
  }),
}))

import {
  upsertWhatsAppPhoneNumber,
  resolveTenantByPhoneNumberId,
  resolveTenantByFlowsWebhookToken,
  getOrCreateFlowsWebhookToken,
  clearWhatsAppPhoneNumber,
} from '@/lib/whatsapp-phone-numbers'

describe('whatsapp-phone-numbers', () => {
  beforeEach(() => {
    upsertFn.mockReset(); selectByPhoneFn.mockReset()
    selectByTokenFn.mockReset(); selectByTenantFn.mockReset()
    updateFn.mockReset(); deleteFn.mockReset()
  })

  it('upsertWhatsAppPhoneNumber faz upsert com onConflict phone_number_id', async () => {
    upsertFn.mockReturnValueOnce({ error: null })
    await upsertWhatsAppPhoneNumber('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1' }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
  })

  it('resolveTenantByPhoneNumberId retorna tenant_id quando encontra', async () => {
    selectByPhoneFn.mockResolvedValueOnce({ data: { tenant_id: 't1' }, error: null })
    const r = await resolveTenantByPhoneNumberId('pn_1')
    expect(r).toBe('t1')
  })

  it('resolveTenantByPhoneNumberId retorna null quando não encontra', async () => {
    selectByPhoneFn.mockResolvedValueOnce({ data: null, error: null })
    const r = await resolveTenantByPhoneNumberId('pn_desconhecido')
    expect(r).toBeNull()
  })

  it('resolveTenantByFlowsWebhookToken retorna tenant_id quando encontra', async () => {
    selectByTokenFn.mockResolvedValueOnce({ data: { tenant_id: 't2' }, error: null })
    const r = await resolveTenantByFlowsWebhookToken('fwh_abc')
    expect(r).toBe('t2')
  })

  it('getOrCreateFlowsWebhookToken retorna token existente sem gerar novo', async () => {
    selectByTenantFn.mockResolvedValueOnce({ data: { flows_webhook_token: 'fwh_existing' }, error: null })
    const r = await getOrCreateFlowsWebhookToken('t1')
    expect(r).toBe('fwh_existing')
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('getOrCreateFlowsWebhookToken gera e persiste quando ausente', async () => {
    selectByTenantFn.mockResolvedValueOnce({ data: { flows_webhook_token: null }, error: null })
    updateFn.mockReturnValueOnce({ error: null })
    const r = await getOrCreateFlowsWebhookToken('t1')
    expect(r).toMatch(/^fwh_[a-f0-9]{32}$/)
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ flows_webhook_token: r }))
  })

  it('getOrCreateFlowsWebhookToken lança se o tenant não tem linha ainda', async () => {
    selectByTenantFn.mockResolvedValueOnce({ data: null, error: null })
    await expect(getOrCreateFlowsWebhookToken('t-sem-linha')).rejects.toThrow()
  })

  it('clearWhatsAppPhoneNumber deleta a linha do tenant', async () => {
    deleteFn.mockReturnValueOnce({ error: null })
    await clearWhatsAppPhoneNumber('t1')
    expect(deleteFn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/whatsapp-phone-numbers.test.ts`
Expected: FAIL — módulo `@/lib/whatsapp-phone-numbers` não existe.

- [ ] **Step 3: Implementar**

```typescript
// lib/whatsapp-phone-numbers.ts
import { getSupabaseAdmin } from '@/lib/supabase'
import { randomUUID } from 'crypto'

export async function upsertWhatsAppPhoneNumber(
  tenantId: string,
  params: { phoneNumberId: string; businessAccountId?: string | null }
): Promise<void> {
  const db = getSupabaseAdmin()!
  const { error } = await db.from('whatsapp_phone_numbers').upsert(
    {
      phone_number_id: params.phoneNumberId,
      tenant_id: tenantId,
      business_account_id: params.businessAccountId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number_id' }
  )
  if (error) throw error
}

export async function resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db
    .from('whatsapp_phone_numbers')
    .select('tenant_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  return data?.tenant_id ?? null
}

export async function resolveTenantByFlowsWebhookToken(token: string): Promise<string | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db
    .from('whatsapp_phone_numbers')
    .select('tenant_id')
    .eq('flows_webhook_token', token)
    .maybeSingle()
  return data?.tenant_id ?? null
}

export async function getOrCreateFlowsWebhookToken(tenantId: string): Promise<string> {
  const db = getSupabaseAdmin()!
  const { data } = await db
    .from('whatsapp_phone_numbers')
    .select('flows_webhook_token')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) {
    throw new Error(
      `Tenant ${tenantId} ainda não tem whatsapp_phone_numbers — salve as credenciais WhatsApp antes de configurar Flows.`
    )
  }
  if (data.flows_webhook_token) return data.flows_webhook_token

  const token = `fwh_${randomUUID().replace(/-/g, '')}`
  const { error } = await db
    .from('whatsapp_phone_numbers')
    .update({ flows_webhook_token: token, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
  if (error) throw error
  return token
}

export async function clearWhatsAppPhoneNumber(tenantId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  const { error } = await db.from('whatsapp_phone_numbers').delete().eq('tenant_id', tenantId)
  if (error) throw error
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/whatsapp-phone-numbers.test.ts`
Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp-phone-numbers.ts lib/whatsapp-phone-numbers.test.ts
git commit -m "feat(2B): lib/whatsapp-phone-numbers.ts — CRUD + geração de flows_webhook_token"
```

---

### Task 3: Write-through em `app/api/settings/credentials/route.ts`

**Files:**
- Modify: `app/api/settings/credentials/route.ts`

**Interfaces:**
- Consumes: `upsertWhatsAppPhoneNumber`, `clearWhatsAppPhoneNumber` (Task 2).
- Produces: nenhuma interface nova — efeito colateral de sincronizar `whatsapp_phone_numbers` sempre que credenciais são salvas/removidas.

- [ ] **Step 1: Import e chamada no POST**

Em `app/api/settings/credentials/route.ts`, adicionar o import:

```typescript
import { upsertWhatsAppPhoneNumber, clearWhatsAppPhoneNumber } from '@/lib/whatsapp-phone-numbers'
```

Logo após o bloco `await settingsDb.saveAll(ctx.tenantId, { phoneNumberId, businessAccountId, accessToken, isConnected: true })` no `POST`, adicionar:

```typescript
    await upsertWhatsAppPhoneNumber(ctx.tenantId, {
      phoneNumberId,
      businessAccountId,
    })
```

- [ ] **Step 2: Chamada no DELETE**

Logo após o bloco `await settingsDb.saveAll(ctx.tenantId, { phoneNumberId: '', businessAccountId: '', accessToken: '', isConnected: false })` no `DELETE`, adicionar:

```typescript
    await clearWhatsAppPhoneNumber(ctx.tenantId)
```

- [ ] **Step 3: Escrever teste do route (TDD após o fato — cobre o efeito colateral)**

```typescript
// app/api/settings/credentials/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false })),
}))
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: () => true }))
const saveAllMock = vi.fn(async () => {})
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { getAll: vi.fn(), saveAll: (...a: any[]) => saveAllMock(...a) } }))
const upsertMock = vi.fn(async () => {})
const clearMock = vi.fn(async () => {})
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  upsertWhatsAppPhoneNumber: (...a: any[]) => upsertMock(...a),
  clearWhatsAppPhoneNumber: (...a: any[]) => clearMock(...a),
}))
vi.mock('@/lib/server-http', () => ({
  fetchWithTimeout: vi.fn(async () => ({ ok: true, json: async () => ({ display_phone_number: '+551199999999', verified_name: 'Test', quality_rating: 'GREEN' }) })),
  safeJson: vi.fn(async () => ({})),
  isAbortError: () => false,
}))

import { POST, DELETE } from './route'

describe('settings/credentials write-through', () => {
  beforeEach(() => { upsertMock.mockClear(); clearMock.mockClear(); saveAllMock.mockClear() })

  it('POST faz upsert em whatsapp_phone_numbers após salvar credenciais', async () => {
    const req = new NextRequest('http://localhost/api/settings/credentials', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' }),
    })
    await POST(req)
    expect(upsertMock).toHaveBeenCalledWith('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1' })
  })

  it('DELETE limpa whatsapp_phone_numbers', async () => {
    await DELETE()
    expect(clearMock).toHaveBeenCalledWith('t1')
  })
})
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run app/api/settings/credentials/route.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: `npx tsc --noEmit` e suíte completa**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc limpo; suíte = baseline + 8 (Task 2) + 2 (esta task), 0 failed.

- [ ] **Step 6: Commit**

```bash
git add app/api/settings/credentials/route.ts app/api/settings/credentials/route.test.ts
git commit -m "feat(2B): write-through whatsapp_phone_numbers ao salvar/remover credenciais WhatsApp"
```

---

### Task 4: Write-through em `lib/google-calendar.ts` (`saveCalendarChannel`)

**Files:**
- Modify: `lib/google-calendar.ts`

**Interfaces:**
- Consumes: tabela `google_calendar_channels` (Task 1).
- Produces: nenhuma interface nova — `saveCalendarChannel` (já chamada internamente por `ensureCalendarChannel`, `clearCalendarIntegration`, `markCalendarNotification`) passa a manter `google_calendar_channels` sincronizada.

- [ ] **Step 1: Modificar `saveCalendarChannel`**

Substituir a implementação atual (linha ~352):

```typescript
export async function saveCalendarChannel(tenantId: string, channel: GoogleCalendarChannel | null): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nao configurado')
  }
  if (!channel) {
    await settingsDb.set(tenantId, SETTINGS_KEYS.channel, '')
    await getSupabaseAdmin()!
      .from('google_calendar_channels')
      .delete()
      .eq('tenant_id', tenantId)
    return
  }
  await settingsDb.set(tenantId, SETTINGS_KEYS.channel, JSON.stringify(channel))
  const { error } = await getSupabaseAdmin()!
    .from('google_calendar_channels')
    .upsert(
      {
        channel_token: channel.token,
        tenant_id: tenantId,
        channel_id: channel.id,
        resource_id: channel.resourceId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel_token' }
    )
  if (error) throw error
}
```

Adicionar `getSupabaseAdmin` ao import existente de `@/lib/supabase` no topo do arquivo (verificar se já não está importado — o arquivo já usa `isSupabaseConfigured` de lá).

- [ ] **Step 2: Escrever teste**

```typescript
// lib/google-calendar.test.ts (adicionar ao arquivo de teste existente, ou criar se não houver)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const settingsSet = vi.fn(async () => {})
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { get: vi.fn(), set: (...a: any[]) => settingsSet(...a) } }))
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => ({
      upsert: upsertMock,
      delete: () => ({ eq: deleteEqMock }),
    }),
  }),
}))
const upsertMock = vi.fn(async () => ({ error: null }))
const deleteEqMock = vi.fn(async () => ({ error: null }))

import { saveCalendarChannel } from '@/lib/google-calendar'

describe('saveCalendarChannel write-through', () => {
  beforeEach(() => { upsertMock.mockClear(); deleteEqMock.mockClear(); settingsSet.mockClear() })

  it('faz upsert em google_calendar_channels ao salvar um canal', async () => {
    await saveCalendarChannel('t1', {
      id: 'ch_1', resourceId: 'res_1', token: 'gc_token_abc',
      calendarId: 'primary', createdAt: new Date().toISOString(),
    })
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel_token: 'gc_token_abc', tenant_id: 't1', channel_id: 'ch_1', resource_id: 'res_1' }),
      expect.objectContaining({ onConflict: 'channel_token' })
    )
  })

  it('deleta de google_calendar_channels quando channel é null', async () => {
    await saveCalendarChannel('t1', null)
    expect(deleteEqMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run lib/google-calendar.test.ts`
Expected: PASS (2/2 novos; se o arquivo já existir com outros testes, todos verdes).

- [ ] **Step 4: `tsc` + suíte completa, commit**

```bash
npx tsc --noEmit && npx vitest run
git add lib/google-calendar.ts lib/google-calendar.test.ts
git commit -m "feat(2B): write-through google_calendar_channels em saveCalendarChannel"
```

---

### Task 5: `lib/verify-token.ts` — migra para `platform_settings`

**Files:**
- Modify: `lib/verify-token.ts`
- Modify: `app/api/meta/diagnostics/route.ts`, `app/api/meta/webhooks/subscription/route.ts`, `app/api/phone-numbers/[phoneNumberId]/webhook/override/route.ts`, `app/api/webhook/info/route.ts`, `app/api/webhook/validate/route.ts`

**Interfaces:**
- Consumes: `platformSettingsDb` (`lib/platform-settings.ts`, Fase 2A Task 7).
- Produces: `getVerifyToken(options?: VerifyTokenOptions): Promise<string>` — **perde o parâmetro `tenantId`** (era o 1º parâmetro; achado no planejamento: `webhook_verify_token` é configuração de plataforma, uma única URL de webhook compartilhada por todos os tenants não pode ter um verify token "por tenant").

- [ ] **Step 1: Reescrever `lib/verify-token.ts`**

```typescript
import { platformSettingsDb } from '@/lib/platform-settings'

interface VerifyTokenOptions {
    readonly?: boolean
}

let inMemoryToken: string | null = null

/**
 * Get or generate the platform-level webhook verify token.
 *
 * Configuração de plataforma, não por tenant: o endpoint /api/webhook é uma
 * única URL compartilhada por todos os tenants, e o hub.verify_token do Meta
 * é validado uma vez na configuração do App (não carrega identidade de tenant).
 *
 * @param options.readonly Se true, não gera um novo token se ausente (evita race conditions).
 */
export async function getVerifyToken(options: VerifyTokenOptions = {}): Promise<string> {
    const { readonly = false } = options

    try {
        const storedToken = await platformSettingsDb.get<string>('webhook_verify_token')
        if (storedToken) return storedToken

        if (process.env.WEBHOOK_VERIFY_TOKEN) {
            return process.env.WEBHOOK_VERIFY_TOKEN.trim()
        }

        if (readonly) {
            if (inMemoryToken) return inMemoryToken
            console.warn('⚠️ getVerifyToken: Token missing and Read-Only. Failing.')
            return 'token-not-found-readonly'
        }

        const newToken = crypto.randomUUID()
        inMemoryToken = newToken
        try {
            await platformSettingsDb.set('webhook_verify_token', newToken)
        } catch (err) {
            console.warn('⚠️ getVerifyToken: Failed to persist token, using in-memory fallback.')
        }
        return newToken
    } catch (err) {
        console.error('💥 getVerifyToken Error:', err)
        if (inMemoryToken) return inMemoryToken
        return process.env.WEBHOOK_VERIFY_TOKEN?.trim() || 'error-retrieving-token'
    }
}
```

- [ ] **Step 2: Atualizar os 5 call-sites — remover o argumento `tenantId`/`ctx.tenantId`**

Em cada um dos 5 arquivos, trocar `getVerifyToken(tenantId)` / `getVerifyToken(ctx.tenantId)` por `getVerifyToken()` (mantendo o resto do código igual). Localizações exatas:
- `app/api/meta/diagnostics/route.ts:687` — `const webhookToken = await getVerifyToken().catch(() => null)`
- `app/api/meta/webhooks/subscription/route.ts:214` — `const verifyToken = await getVerifyToken()`
- `app/api/phone-numbers/[phoneNumberId]/webhook/override/route.ts:92` — `const verifyToken = await getVerifyToken()`
- `app/api/webhook/info/route.ts:14` — `const webhookToken = await getVerifyToken()`
- `app/api/webhook/validate/route.ts:83` — troca `settingsDb.get(tenantId, 'webhook_verify_token')` por `platformSettingsDb.get('webhook_verify_token')` (import `platformSettingsDb` de `@/lib/platform-settings` em vez do uso pontual de `settingsDb` para essa chave especificamente — se `settingsDb` for usado para outras chaves no mesmo arquivo, mantenha o import, só troque esta chamada).

- [ ] **Step 3: `app/api/webhook/route.ts` GET — remove a dependência de tenant**

Trocar (linha ~511-513):
```typescript
  const tenantId = await resolveWebhookTenantId()

  const MY_VERIFY_TOKEN = await getVerifyToken(tenantId, { readonly: true })
```
por:
```typescript
  const MY_VERIFY_TOKEN = await getVerifyToken({ readonly: true })
```

Remover o import de `resolveWebhookTenantId` **apenas se** não for mais usado em nenhum outro lugar do arquivo (o POST ainda vai usar uma resolução de tenant própria — ver Task 6 — então o import provavelmente muda de nome/origem, não desaparece; confirmar com grep antes de remover).

- [ ] **Step 4: Rodar tsc + suíte, ajustar testes existentes que mockem `getVerifyToken` com o argumento antigo**

Run: `npx tsc --noEmit` — deve apontar qualquer call-site esquecido (assinatura mudou de posicional `tenantId` obrigatório para nenhum argumento obrigatório; um `tenantId` deixado por engano vira erro de tipo).
Run: `npx vitest run` — corrigir mocks de teste que hoje esperam `getVerifyToken(tenantId, ...)`.
Expected: tsc limpo; suíte sem regressão.

- [ ] **Step 5: Commit**

```bash
git add lib/verify-token.ts app/api/meta/diagnostics/route.ts app/api/meta/webhooks/subscription/route.ts "app/api/phone-numbers/[phoneNumberId]/webhook/override/route.ts" app/api/webhook/info/route.ts app/api/webhook/validate/route.ts app/api/webhook/route.ts
git commit -m "fix(2B): webhook_verify_token vira config de plataforma (platform_settings), não por tenant"
```

---

### Task 6: `app/api/webhook/route.ts` POST — resolução de tenant por `phone_number_id`

**Files:**
- Modify: `app/api/webhook/route.ts`

**Interfaces:**
- Consumes: `resolveTenantByPhoneNumberId` (Task 2).
- Produces: o handler POST resolve `tenantId` por `entry` do payload, não mais globalmente para o payload inteiro.

**Contexto:** hoje o handler faz `const tenantId = await resolveWebhookTenantId()` uma única vez para todo o payload (linha ~571) e usa esse `tenantId` para todas as chamadas subsequentes (`ensureWorkflowRecord`, `getWhatsAppAccessToken`, etc. — ler o arquivo completo antes de editar para localizar todos os usos de `tenantId` no corpo do POST, pois a variável é referenciada dezenas de vezes ao longo do handler). Esta task troca a fonte da resolução; **não muda a assunção de que existe um único `tenantId` por invocação do handler** (o spec já observa que múltiplos `entry`/`changes` com `phone_number_id` diferentes no mesmo payload são um caso raro — resolver por-entry de verdade, com fan-out completo por tenant, fica fora de escopo aqui; a mudança mínima e correta é: extrair o `phone_number_id` do **primeiro** entry/change com `metadata.phone_number_id` presente, e se um entry posterior tiver um `phone_number_id` diferente, logar um warning e processá-lo sob o mesmo `tenantId` já resolvido é incorreto — em vez disso, se detectar `phone_number_id` divergente entre entries, retornar 200 processando apenas os entries do primeiro `phone_number_id` e logar quantos foram ignorados).

- [ ] **Step 1: Ler o arquivo completo e listar todo uso de `tenantId` no POST**

Run: `grep -n "tenantId" app/api/webhook/route.ts` — usar a lista para conferir que nenhum uso foi esquecido nos steps seguintes.

- [ ] **Step 2: Substituir a resolução de tenant**

Trocar (linha ~571):
```typescript
  // Payload da Meta pode trazer mensagens/status de diferentes WABAs (phone_number_id
  // em change.value.metadata) e o endpoint /api/webhook é compartilhado por todos os
  // tenants — não há hoje um índice phone_number_id -> tenant_id para resolver isso.
  // Guard intencional até Fase 2B (schema dedicado de phone numbers com tenant_id).
  const tenantId = await resolveWebhookTenantId()
```
por:
```typescript
  const entries = Array.isArray(body?.entry) ? body.entry : []
  const phoneNumberIds = new Set<string>()
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const pnId = change?.value?.metadata?.phone_number_id
      if (pnId) phoneNumberIds.add(String(pnId))
    }
  }

  if (phoneNumberIds.size === 0) {
    console.warn('[webhook] Payload sem phone_number_id em nenhum entry/change — ignorando.')
    return NextResponse.json({ status: 'ignored', reason: 'no_phone_number_id' })
  }

  const [firstPhoneNumberId, ...restPhoneNumberIds] = Array.from(phoneNumberIds)
  if (restPhoneNumberIds.length > 0) {
    console.warn(
      `[webhook] Payload com múltiplos phone_number_id (${phoneNumberIds.size}) — processando só ${firstPhoneNumberId}, ignorando ${restPhoneNumberIds.length}.`
    )
  }

  const tenantId = await resolveTenantByPhoneNumberId(firstPhoneNumberId)
  if (!tenantId) {
    console.warn(`[webhook] phone_number_id ${firstPhoneNumberId} não mapeado a nenhum tenant — ignorando.`)
    return NextResponse.json({ status: 'ignored', reason: 'unknown_phone_number_id' })
  }
```

- [ ] **Step 3: Atualizar imports**

Trocar `import { resolveWebhookTenantId } from '@/lib/tenant-context'` por `import { resolveTenantByPhoneNumberId } from '@/lib/whatsapp-phone-numbers'` — **exceto** se o arquivo ainda usar `resolveWebhookTenantId` em outro ponto (não deveria, após a Task 5 remover o uso do GET; confirmar via grep antes de remover o import).

- [ ] **Step 4: Escrever teste de resolução**

Se já existir um arquivo de teste para esta rota, adicionar os casos abaixo; senão criar `app/api/webhook/route.test.ts` mínimo cobrindo só a resolução de tenant (não a lógica de processamento inteira, que já tem cobertura própria em módulos como `whatsapp-status-events`):

```typescript
// app/api/webhook/route.test.ts (adicionar se o arquivo já existir; senão criar mínimo)
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantMock = vi.fn()
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  resolveTenantByPhoneNumberId: (...a: any[]) => resolveTenantMock(...a),
}))
// Mocks adicionais (getSupabaseAdmin, verifyMetaWebhookSignature, etc.) conforme
// necessário para o arquivo compilar — seguir o padrão de mocks já usado em
// testes vizinhos de app/api/webhook/**, se existirem.

import { POST } from './route'

describe('webhook route — resolução de tenant', () => {
  it('retorna 200 ignorado quando phone_number_id não está mapeado', async () => {
    resolveTenantMock.mockResolvedValueOnce(null)
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn_desconhecido' } } }] }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'x-hub-signature-256': 'sha256=valid-mock' },
    })
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.reason).toBe('unknown_phone_number_id')
  })
})
```

Nota: se a assinatura HMAC (`verifyMetaWebhookSignature`) bloquear o teste, mocar essa função também — ela não é o foco desta task.

- [ ] **Step 5: Rodar, `tsc`, suíte completa**

Run: `npx vitest run app/api/webhook/route.test.ts && npx tsc --noEmit && npx vitest run`
Expected: teste novo passa; tsc limpo; suíte sem regressão.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhook/route.ts app/api/webhook/route.test.ts
git commit -m "feat(2B): webhook Meta resolve tenant via whatsapp_phone_numbers (phone_number_id)"
```

---

### Task 7: `app/api/integrations/google-calendar/webhook/route.ts` — resolução por `channel_token`

**Files:**
- Modify: `app/api/integrations/google-calendar/webhook/route.ts`

**Interfaces:**
- Consumes: `resolveTenantByFlowsWebhookToken`... **não**, consumes `resolveTenantByChannelToken` — nome novo, adicionar a `lib/whatsapp-phone-numbers.ts`? **Não**: este lookup é em `google_calendar_channels`, tabela diferente. Adicionar a função equivalente em um novo pequeno módulo.

- [ ] **Step 1: Adicionar `resolveTenantByChannelToken` (mesmo arquivo de write-through, `lib/google-calendar.ts`, para manter tudo de Calendar num só lugar)**

```typescript
// lib/google-calendar.ts — adicionar próximo de getCalendarChannel/saveCalendarChannel
export async function resolveTenantByChannelToken(channelToken: string): Promise<string | null> {
  const db = getSupabaseAdmin()
  if (!db) return null
  const { data } = await db
    .from('google_calendar_channels')
    .select('tenant_id')
    .eq('channel_token', channelToken)
    .maybeSingle()
  return data?.tenant_id ?? null
}
```

- [ ] **Step 2: Reescrever o handler POST**

Substituir o conteúdo de `app/api/integrations/google-calendar/webhook/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getCalendarChannel, markCalendarNotification, resolveTenantByChannelToken } from '@/lib/google-calendar'
import { isSupabaseConfigured } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'Supabase nao configurado' }, { status: 400 })
    }

    const channelToken = request.headers.get('x-goog-channel-token')
    const resourceState = request.headers.get('x-goog-resource-state')

    if (!channelToken) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const tenantId = await resolveTenantByChannelToken(channelToken)
    if (!tenantId) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const channel = await getCalendarChannel(tenantId)
    if (!channel || channelToken !== channel.token) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    await markCalendarNotification(tenantId, { resourceState })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[google-calendar] webhook error:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Escrever teste**

```typescript
// app/api/integrations/google-calendar/webhook/route.test.ts
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantMock = vi.fn()
const getChannelMock = vi.fn()
const markNotificationMock = vi.fn()
vi.mock('@/lib/google-calendar', () => ({
  resolveTenantByChannelToken: (...a: any[]) => resolveTenantMock(...a),
  getCalendarChannel: (...a: any[]) => getChannelMock(...a),
  markCalendarNotification: (...a: any[]) => markNotificationMock(...a),
}))
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: () => true }))

import { POST } from './route'

describe('google-calendar webhook — resolução de tenant', () => {
  it('401 quando channel_token não está mapeado', async () => {
    resolveTenantMock.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost/api/integrations/google-calendar/webhook', {
      method: 'POST',
      headers: { 'x-goog-channel-token': 'gc_desconhecido' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('200 e processa quando channel_token bate', async () => {
    resolveTenantMock.mockResolvedValueOnce('t1')
    getChannelMock.mockResolvedValueOnce({ token: 'gc_valido', id: 'ch1', resourceId: 'res1', calendarId: 'primary', createdAt: new Date().toISOString() })
    markNotificationMock.mockResolvedValueOnce(undefined)
    const req = new NextRequest('http://localhost/api/integrations/google-calendar/webhook', {
      method: 'POST',
      headers: { 'x-goog-channel-token': 'gc_valido', 'x-goog-resource-state': 'exists' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(markNotificationMock).toHaveBeenCalledWith('t1', { resourceState: 'exists' })
  })
})
```

- [ ] **Step 4: Rodar, `tsc`, suíte completa**

Run: `npx vitest run app/api/integrations/google-calendar/webhook/route.test.ts lib/google-calendar.test.ts && npx tsc --noEmit && npx vitest run`
Expected: 2/2 novos passam; tsc limpo; suíte sem regressão.

- [ ] **Step 5: Commit**

```bash
git add lib/google-calendar.ts app/api/integrations/google-calendar/webhook/route.ts app/api/integrations/google-calendar/webhook/route.test.ts
git commit -m "feat(2B): webhook Google Calendar resolve tenant via google_calendar_channels (channel_token)"
```

---

### Task 8: Endpoint de WhatsApp Flows — rota `[token]` + threading de tenantId

**Files:**
- Create: `app/api/flows/endpoint/[token]/route.ts`
- Delete: `app/api/flows/endpoint/route.ts`
- Modify: `lib/whatsapp/flow-endpoint-handlers.ts`

**Interfaces:**
- Consumes: `resolveTenantByFlowsWebhookToken` (Task 2).
- Produces: `handleFlowAction(tenantId: string, request: FlowDataExchangeRequest)` — assinatura muda (ganha `tenantId` como 1º parâmetro).

- [ ] **Step 1: Ler `lib/whatsapp/flow-endpoint-handlers.ts` por completo**

Antes de editar, rodar `grep -n "^export async function\|^async function" lib/whatsapp/flow-endpoint-handlers.ts` para listar todas as funções internas que `handleFlowAction` chama (`handleInit`, `handleDataExchange`, `handleBack`, e quaisquer outras) — cada uma que hoje resolve tenant via `resolveWebhookTenantId()` internamente (linha ~689 é uma delas, `handleDataExchange`) precisa ganhar `tenantId` como parâmetro em vez disso. Funções que já recebem `tenantId` como parâmetro (ex.: chamadas a partir de `handleFlowAction` que já passam adiante) só precisam propagar.

- [ ] **Step 2: `handleFlowAction` ganha `tenantId`**

Trocar a assinatura (linha ~668-671):
```typescript
export async function handleFlowAction(
  request: FlowDataExchangeRequest
): Promise<Record<string, unknown>> {
  const { action, screen, data, flow_token: flowToken } = request
```
por:
```typescript
export async function handleFlowAction(
  tenantId: string,
  request: FlowDataExchangeRequest
): Promise<Record<string, unknown>> {
  const { action, screen, data, flow_token: flowToken } = request
```

- [ ] **Step 3: `handleDataExchange` para de resolver tenant sozinho**

Trocar (linha ~687-689):
```typescript
  // Rota sem contexto de sessão (webhook Meta) — resolve o tenant no ponto de
  // entrada. Até a Fase 2B, isso lança sempre (ver resolveWebhookTenantId).
  const tenantId = await resolveWebhookTenantId()
```
por (remover essas linhas inteiramente — `tenantId` já chega como parâmetro da função; se `handleDataExchange` for uma função separada de `handleFlowAction` que recebe `tenantId` via parâmetro próprio, adicionar `tenantId: string` à assinatura dela e remover a resolução interna; se for um bloco inline dentro de `handleFlowAction`, `tenantId` já está no escopo pelo Step 2 e a linha é só removida).

Remover o import de `resolveWebhookTenantId` no topo do arquivo se não for mais usado em nenhum outro lugar de `flow-endpoint-handlers.ts` (confirmar via grep).

Propagar `tenantId` para toda chamada subsequente que hoje usa a variável (ex.: `loadFlowJsonFromToken(tenantId, flowToken)`, `handleInit(tenantId, runtime)` já recebem `tenantId` — nenhuma mudança nesses, só a origem do valor muda de "resolvido aqui dentro" para "recebido como parâmetro").

- [ ] **Step 4: Criar a nova rota `[token]`**

```typescript
// app/api/flows/endpoint/[token]/route.ts
/**
 * WhatsApp Flow Endpoint (por tenant)
 *
 * Endpoint para data_exchange em WhatsApp Flows. A URL carrega um token opaco
 * por tenant (flows_webhook_token) porque a chave privada necessária para
 * decifrar o payload é per-tenant — não há como resolver o tenant depois de
 * decriptar (payload não carrega phone_number_id nem nada identificável).
 *
 * POST /api/flows/endpoint/[token]
 */

import { NextRequest, NextResponse } from 'next/server'
import { settingsDb } from '@/lib/supabase-db'
import { resolveTenantByFlowsWebhookToken } from '@/lib/whatsapp-phone-numbers'
import {
  decryptRequest,
  encryptResponse,
  createErrorResponse,
  generateKeyPair,
  type FlowDataExchangeRequest,
} from '@/lib/whatsapp/flow-endpoint-crypto'
import { handleFlowAction } from '@/lib/whatsapp/flow-endpoint-handlers'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { metaSetEncryptionPublicKey } from '@/lib/meta-flows-api'

const PRIVATE_KEY_SETTING = 'whatsapp_flow_private_key'
const PUBLIC_KEY_SETTING = 'whatsapp_flow_public_key'

interface Params {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { token } = await params
    const tenantId = await resolveTenantByFlowsWebhookToken(token)
    if (!tenantId) {
      return NextResponse.json({ error: 'Endpoint não encontrado' }, { status: 404 })
    }

    const body = await request.json()
    console.log('[flow-endpoint] 📥 POST received at', new Date().toISOString())

    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
      console.error('[flow-endpoint] ❌ Campos obrigatorios ausentes')
      return NextResponse.json({ error: 'Campos obrigatorios ausentes' }, { status: 400 })
    }

    let privateKey = await settingsDb.get(tenantId, PRIVATE_KEY_SETTING)

    if (!privateKey) {
      console.log('[flow-endpoint] 🔑 Chave privada não encontrada, gerando automaticamente...')
      const { publicKey, privateKey: newPrivateKey } = generateKeyPair()
      await Promise.all([
        settingsDb.set(tenantId, PRIVATE_KEY_SETTING, newPrivateKey),
        settingsDb.set(tenantId, PUBLIC_KEY_SETTING, publicKey),
      ])
      privateKey = newPrivateKey
      console.log('[flow-endpoint] ✅ Chaves RSA geradas e salvas automaticamente')

      try {
        const credentials = await getWhatsAppCredentials(tenantId)
        if (credentials?.accessToken && credentials?.phoneNumberId) {
          await metaSetEncryptionPublicKey({
            accessToken: credentials.accessToken,
            phoneNumberId: credentials.phoneNumberId,
            publicKey,
          })
          console.log('[flow-endpoint] ✅ Chave pública sincronizada com a Meta automaticamente')
        } else {
          console.log('[flow-endpoint] ⚠️ Credenciais WhatsApp não configuradas, sincronização pendente')
        }
      } catch (syncError) {
        console.error('[flow-endpoint] ⚠️ Falha ao sincronizar com Meta (não-bloqueante):', syncError)
      }
    }

    let decrypted
    try {
      decrypted = decryptRequest(
        { encrypted_flow_data, encrypted_aes_key, initial_vector },
        privateKey
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isOaepError = errorMessage.includes('oaep') || errorMessage.includes('OAEP')
      console.error(
        '[flow-endpoint] ❌ Erro ao descriptografar:',
        isOaepError
          ? 'OAEP key mismatch — chave pública registrada na Meta não corresponde à chave privada local. Verifique as chaves em /settings/flows'
          : errorMessage
      )
      return NextResponse.json({ error: 'Falha na descriptografia' }, { status: 421 })
    }

    const flowRequest = decrypted.decryptedBody as unknown as FlowDataExchangeRequest
    console.log('[flow-endpoint] 🔓 Decrypted - Action:', flowRequest.action, 'Screen:', flowRequest.screen)

    if (flowRequest.action === 'ping') {
      console.log('[flow-endpoint] 🏓 PING received at', new Date().toISOString())
      const pingResponse = { data: { status: 'active' } }
      const encryptedPingResponse = encryptResponse(pingResponse, decrypted.aesKeyBuffer, decrypted.initialVectorBuffer)
      return new NextResponse(encryptedPingResponse, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }

    let response
    try {
      response = await handleFlowAction(tenantId, flowRequest)
      console.log('[flow-endpoint] ✅ Handler response:', JSON.stringify(response).substring(0, 500))
    } catch (error) {
      console.error('[flow-endpoint] ❌ Erro no handler:', error)
      response = createErrorResponse(error instanceof Error ? error.message : 'Erro interno')
    }

    const encryptedResponse = encryptResponse(response, decrypted.aesKeyBuffer, decrypted.initialVectorBuffer)
    return new NextResponse(encryptedResponse, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  } catch (error) {
    console.error('[flow-endpoint] Erro geral:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

/**
 * GET - Health check simples (sem criptografia)
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params
  const tenantId = await resolveTenantByFlowsWebhookToken(token)
  if (!tenantId) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 })
  }
  const privateKey = await settingsDb.get(tenantId, PRIVATE_KEY_SETTING)
  const configured = !!privateKey
  return NextResponse.json({
    status: configured ? 'ready' : 'not_configured',
    message: configured ? 'Flow endpoint configurado e pronto' : 'Chave privada nao configurada. Configure em /settings/flows',
  })
}
```

- [ ] **Step 5: Remover a rota antiga**

```bash
git rm app/api/flows/endpoint/route.ts
```

- [ ] **Step 6: Rodar `tsc` — vai apontar os call-sites que constroem a URL antiga (Task 9 corrige)**

Run: `npx tsc --noEmit`
Expected: sem erros de tipo relacionados a este arquivo (a rota em si compila); os usos da URL antiga em outros arquivos não geram erro de tipo (são strings), então não aparecem no tsc — ficam para a Task 9 via grep, não via tsc.

- [ ] **Step 7: Testes de `handleFlowAction`/`handleDataExchange`**

Se `lib/whatsapp/flow-endpoint-handlers.ts` já tiver testes cobrindo essas funções, rodar e ajustar as chamadas para incluir `tenantId` como primeiro argumento (mock de valor `'t1'`, por exemplo). Se não houver testes existentes, não criar uma suíte nova aqui — fora de escopo desta task (é lógica de negócio já existente, só a assinatura muda).

Run: `npx vitest run lib/whatsapp/flow-endpoint-handlers.test.ts` (se existir)
Expected: PASS, sem regressão.

- [ ] **Step 8: Suíte completa e commit**

```bash
npx vitest run
git add app/api/flows/endpoint/ lib/whatsapp/flow-endpoint-handlers.ts
git commit -m "feat(2B): endpoint de WhatsApp Flows vira URL por tenant (flows_webhook_token)"
```

---

### Task 9: Atualizar construção da URL do endpoint de Flows (3 call-sites)

**Files:**
- Modify: `app/api/flows/endpoint/keys/route.ts`, `app/api/flows/endpoint/test/route.ts`, `app/api/flows/[id]/meta/publish/route.ts`

**Interfaces:**
- Consumes: `getOrCreateFlowsWebhookToken` (Task 2).

**Contexto:** os três arquivos constroem a URL do endpoint como `${getAppUrl()}/api/flows/endpoint` (ou variantes via headers). Todos precisam passar a incluir o token: `${getAppUrl()}/api/flows/endpoint/${token}`.

- [ ] **Step 1: `app/api/flows/endpoint/keys/route.ts`**

Adicionar import: `import { getOrCreateFlowsWebhookToken } from '@/lib/whatsapp-phone-numbers'`.

Na função `resolveEndpointUrlFromRequest`, adicionar um parâmetro `token`:
```typescript
function resolveEndpointUrlFromRequest(request: Request, token: string): string | null {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (!host) return null
  return `${proto}://${host}/api/flows/endpoint/${token}`
}
```

No `GET`, antes de montar `envEndpointUrl`/`headerEndpointUrl`, resolver o token:
```typescript
    const flowsToken = await getOrCreateFlowsWebhookToken(ctx.tenantId)
```
e trocar:
```typescript
    const envEndpointUrl = process.env.NEXT_PUBLIC_APP_URL ? `${getAppUrl()}/api/flows/endpoint` : null
    const headerEndpointUrl = resolveEndpointUrlFromRequest(request)
```
por:
```typescript
    const envEndpointUrl = process.env.NEXT_PUBLIC_APP_URL ? `${getAppUrl()}/api/flows/endpoint/${flowsToken}` : null
    const headerEndpointUrl = resolveEndpointUrlFromRequest(request, flowsToken)
```

Nota: `getOrCreateFlowsWebhookToken` lança se o tenant ainda não tem linha em `whatsapp_phone_numbers` (não salvou credenciais WhatsApp ainda) — envolver a chamada em try/catch e retornar um estado "credenciais WhatsApp necessárias antes de configurar Flows" em vez de deixar a rota estourar 500. Verificar o padrão de erro já usado no restante do arquivo para manter consistência.

- [ ] **Step 2: `app/api/flows/endpoint/test/route.ts`**

Adicionar import: `import { getOrCreateFlowsWebhookToken } from '@/lib/whatsapp-phone-numbers'`.

Trocar `buildEndpointUrl` (função sem argumentos) por:
```typescript
function buildEndpointUrl(token: string): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL) return null
  return `${getAppUrl()}/api/flows/endpoint/${token}`
}
```

No `GET`, após resolver `ctx.tenantId`:
```typescript
  const flowsToken = await getOrCreateFlowsWebhookToken(ctx.tenantId)
  const envEndpointUrl = buildEndpointUrl(flowsToken)
```

- [ ] **Step 3: `app/api/flows/[id]/meta/publish/route.ts`**

Adicionar import: `import { getOrCreateFlowsWebhookToken } from '@/lib/whatsapp-phone-numbers'`.

Trocar `getFlowEndpointUrl` (recebe `tenantId`, já tem o parâmetro):
```typescript
async function getFlowEndpointUrl(tenantId: string): Promise<string | null> {
  const privateKey = await settingsDb.get(tenantId, 'whatsapp_flow_private_key')
  if (!privateKey) return null

  if (process.env.NEXT_PUBLIC_APP_URL) {
    const flowsToken = await getOrCreateFlowsWebhookToken(tenantId)
    return `${getAppUrl()}/api/flows/endpoint/${flowsToken}`
  }

  const storedEndpointUrl = await settingsDb.get(tenantId, ENDPOINT_URL_SETTING)
  const resolved = storedEndpointUrl || null
  console.log('[publish] 📍 Endpoint URL resolvida:', resolved, '(stored:', storedEndpointUrl, ')')
  return resolved
}
```

- [ ] **Step 4: `npx tsc --noEmit` + suíte completa**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc limpo; sem regressão. Ajustar mocks de teste dos 3 arquivos se existirem (adicionar mock de `getOrCreateFlowsWebhookToken`).

- [ ] **Step 5: Grep final para confirmar que não sobrou nenhuma referência à URL sem token**

Run: `grep -rn "api/flows/endpoint'" --include="*.ts" app/ lib/` (aspas simples fechando logo após `endpoint` = URL sem segmento de token)
Expected: nenhum resultado fora de comentários/docs.

- [ ] **Step 6: Commit**

```bash
git add app/api/flows/endpoint/keys/route.ts app/api/flows/endpoint/test/route.ts "app/api/flows/[id]/meta/publish/route.ts"
git commit -m "feat(2B): URL do endpoint de Flows inclui flows_webhook_token nos 3 pontos de construção"
```

---

### Task 10: `lib/builder/workflow-db.ts` — tenant-scoping completo (7 funções)

**Files:**
- Modify: `lib/builder/workflow-db.ts`

**Interfaces:**
- Produces (assinaturas finais — `tenantId` sempre 2º parâmetro, logo após `supabase`):
  - `fetchWorkflowRecord(supabase, tenantId, workflowId): Promise<WorkflowRecord | null>`
  - `ensureWorkflowRecord(supabase, tenantId, workflowId, ownerCompanyId?): Promise<WorkflowRecord>`
  - `createWorkflowRecord(supabase, tenantId, input, ownerCompanyId?): Promise<WorkflowRecord>`
  - `updateWorkflowRecord(supabase, tenantId, workflowId, patch): Promise<WorkflowRecord>`
  - `listWorkflowRecords(supabase, tenantId, ownerCompanyId?): Promise<WorkflowRecord[]>`
  - `createNewVersion(supabase, tenantId, workflowId, input): Promise<WorkflowVersionRow>`
  - `getCompanyId(supabase, tenantId): Promise<string | null>`

**Achado no planejamento (fora do desenho original do spec):** `fetchWorkflowRecord` e `listWorkflowRecords` hoje leem sem filtro de `tenant_id`, usando sempre `getSupabaseAdmin()` (bypassa RLS) nas 13 rotas chamadoras — isso é um vazamento cross-tenant real (qualquer tenant com um `workflowId` válido de outro tenant consegue lê-lo), não só o bug de `NOT NULL` no insert que o spec original cobria. `createNewVersion` também insere em `workflow_versions` sem `tenant_id` (mesmo bug de constraint das outras 3 funções já cobertas pelo spec).

- [ ] **Step 1: `fetchWorkflowRecord` — adicionar filtro de tenant**

```typescript
export async function fetchWorkflowRecord(
  supabase: SupabaseClient,
  tenantId: string,
  workflowId: string
): Promise<WorkflowRecord | null> {
  const { data: workflow } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .eq("tenant_id", tenantId)
    .maybeSingle<WorkflowRow>();

  if (!workflow) {
    return null;
  }

  const versionId = workflow.active_version_id;
  if (!versionId) {
    return null;
  }

  const { data: version } = await supabase
    .from("workflow_versions")
    .select("*")
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .maybeSingle<WorkflowVersionRow>();

  if (!version) {
    return null;
  }

  return { workflow, version };
}
```

- [ ] **Step 2: `ensureWorkflowRecord` — `tenantId` + inserts com `tenant_id`**

```typescript
export async function ensureWorkflowRecord(
  supabase: SupabaseClient,
  tenantId: string,
  workflowId: string,
  ownerCompanyId?: string | null
): Promise<WorkflowRecord> {
  const existing = await fetchWorkflowRecord(supabase, tenantId, workflowId);
  if (existing) return existing;

  const graph = buildDefaultGraph();
  const now = new Date().toISOString();
  const versionId = nanoid();

  const { error: workflowError } = await supabase.from("workflows").insert({
    id: workflowId,
    tenant_id: tenantId,
    name: DEFAULT_WORKFLOW_NAME,
    description: null,
    status: "draft",
    owner_company_id: ownerCompanyId ?? null,
    active_version_id: null,
    created_at: now,
    updated_at: now,
  });
  if (workflowError) {
    throw new Error(`Failed to create workflow: ${workflowError.message}`);
  }

  const { error: versionError } = await supabase.from("workflow_versions").insert({
    id: versionId,
    tenant_id: tenantId,
    workflow_id: workflowId,
    version: 1,
    status: "draft",
    nodes: graph.nodes,
    edges: graph.edges,
    created_at: now,
    updated_at: now,
  });
  if (versionError) {
    throw new Error(`Failed to create workflow version: ${versionError.message}`);
  }

  const { error: linkError } = await supabase.from("workflows").update({
    active_version_id: versionId,
    updated_at: now,
  }).eq("id", workflowId).eq("tenant_id", tenantId);
  if (linkError) {
    throw new Error(`Failed to link workflow version: ${linkError.message}`);
  }

  const created = await fetchWorkflowRecord(supabase, tenantId, workflowId);
  if (!created) {
    throw new Error("Failed to create workflow");
  }
  return created;
}
```

- [ ] **Step 3: `createWorkflowRecord` — `tenantId` + inserts com `tenant_id`**

```typescript
export async function createWorkflowRecord(
  supabase: SupabaseClient,
  tenantId: string,
  input: WorkflowData,
  ownerCompanyId?: string | null
): Promise<WorkflowRecord> {
  const workflowId = input.id ?? nanoid();
  const versionId = nanoid();
  const now = new Date().toISOString();

  const { error: workflowError } = await supabase.from("workflows").insert({
    id: workflowId,
    tenant_id: tenantId,
    name: input.name ?? DEFAULT_WORKFLOW_NAME,
    description: input.description ?? null,
    status: "draft",
    owner_company_id: ownerCompanyId ?? null,
    active_version_id: null,
    created_at: now,
    updated_at: now,
  });
  if (workflowError) {
    throw new Error(`Failed to create workflow: ${workflowError.message}`);
  }

  const { error: versionError } = await supabase.from("workflow_versions").insert({
    id: versionId,
    tenant_id: tenantId,
    workflow_id: workflowId,
    version: 1,
    status: "draft",
    nodes: input.nodes,
    edges: input.edges,
    created_at: now,
    updated_at: now,
  });
  if (versionError) {
    throw new Error(`Failed to create workflow version: ${versionError.message}`);
  }

  const { error: linkError } = await supabase.from("workflows").update({
    active_version_id: versionId,
    updated_at: now,
  }).eq("id", workflowId).eq("tenant_id", tenantId);
  if (linkError) {
    throw new Error(`Failed to link workflow version: ${linkError.message}`);
  }

  const created = await fetchWorkflowRecord(supabase, tenantId, workflowId);
  if (!created) {
    throw new Error("Failed to create workflow");
  }
  return created;
}
```

- [ ] **Step 4: `updateWorkflowRecord` — `tenantId`**

```typescript
export async function updateWorkflowRecord(
  supabase: SupabaseClient,
  tenantId: string,
  workflowId: string,
  patch: Partial<WorkflowData>
): Promise<WorkflowRecord> {
  const existing = await ensureWorkflowRecord(supabase, tenantId, workflowId);
  const now = new Date().toISOString();

  await supabase.from("workflows").update({
    name: patch.name ?? existing.workflow.name,
    description:
      patch.description === undefined
        ? existing.workflow.description
        : patch.description,
    updated_at: now,
  }).eq("id", workflowId).eq("tenant_id", tenantId);

  const versionId = existing.workflow.active_version_id;
  if (!versionId) {
    throw new Error("Workflow missing active version");
  }

  await supabase.from("workflow_versions").update({
    nodes: patch.nodes ?? existing.version.nodes,
    edges: patch.edges ?? existing.version.edges,
    updated_at: now,
  }).eq("id", versionId).eq("tenant_id", tenantId);

  const updated = await fetchWorkflowRecord(supabase, tenantId, workflowId);
  if (!updated) {
    throw new Error("Failed to update workflow");
  }
  return updated;
}
```

- [ ] **Step 5: `listWorkflowRecords` — `tenantId`**

```typescript
export async function listWorkflowRecords(
  supabase: SupabaseClient,
  tenantId: string,
  ownerCompanyId?: string | null
): Promise<WorkflowRecord[]> {
  let query = supabase.from("workflows").select("*").eq("tenant_id", tenantId).order("updated_at", {
    ascending: false,
  });
  if (ownerCompanyId) {
    query = query.eq("owner_company_id", ownerCompanyId);
  }
  const { data } = await query;
  if (!data || data.length === 0) return [];

  const versionIds = data
    .map((workflow) => workflow.active_version_id)
    .filter(Boolean) as string[];
  if (versionIds.length === 0) return [];

  const { data: versions } = await supabase
    .from("workflow_versions")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("id", versionIds);

  const versionMap = new Map(
    (versions || []).map((version) => [version.id, version])
  );

  const workflowIds = (data as WorkflowRow[]).map((workflow) => workflow.id);
  const { data: publishedVersions } = await supabase
    .from("workflow_versions")
    .select("workflow_id, version")
    .eq("tenant_id", tenantId)
    .in("workflow_id", workflowIds)
    .eq("status", "published");

  const publishedMap = new Map<string, number>();
  for (const row of publishedVersions || []) {
    const current = publishedMap.get(row.workflow_id) ?? 0;
    if (row.version > current) {
      publishedMap.set(row.workflow_id, row.version);
    }
  }

  return (data as WorkflowRow[])
    .map((workflow) => {
      const version = workflow.active_version_id
        ? versionMap.get(workflow.active_version_id)
        : undefined;
      if (!version) return null;
      return {
        workflow,
        version,
        lastPublishedVersion: publishedMap.get(workflow.id) ?? null,
      } as WorkflowRecord;
    })
    .filter((record): record is WorkflowRecord => Boolean(record));
}
```

- [ ] **Step 6: `createNewVersion` — `tenantId` + insert com `tenant_id`**

```typescript
export async function createNewVersion(
  supabase: SupabaseClient,
  tenantId: string,
  workflowId: string,
  input: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; status: string }
): Promise<WorkflowVersionRow> {
  const { data: latestVersion } = await supabase
    .from("workflow_versions")
    .select("version")
    .eq("workflow_id", workflowId)
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  const version = (latestVersion?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const versionId = nanoid();

  await supabase.from("workflow_versions").insert({
    id: versionId,
    tenant_id: tenantId,
    workflow_id: workflowId,
    version,
    status: input.status,
    nodes: input.nodes,
    edges: input.edges,
    created_at: now,
    updated_at: now,
    published_at: input.status === "published" ? now : null,
  });

  const { data: created } = await supabase
    .from("workflow_versions")
    .select("*")
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .single<WorkflowVersionRow>();

  if (!created) {
    throw new Error("Failed to create workflow version");
  }

  return created;
}
```

- [ ] **Step 7: `getCompanyId` — filtro de tenant**

```typescript
export async function getCompanyId(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data?.value) {
    return null;
  }
  return data.value;
}
```

- [ ] **Step 8: `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: erros nos 13 call-sites em `app/api/builder/**` e nos handlers `execute`/`resume` — esperado, corrigidos nas Tasks 11 e 12. Confirmar que os erros são exatamente "Expected N arguments, but got N-1" (assinatura mudou) e não outra coisa.

- [ ] **Step 9: Commit**

```bash
git add lib/builder/workflow-db.ts
git commit -m "fix(2B): workflow-db.ts tenant-scoped nas 7 funções (fecha vazamento cross-tenant em fetch/list + bug de insert em createNewVersion)"
```

---

### Task 11: Call-sites com sessão de `workflow-db.ts` (11 rotas)

**Files:**
- Modify: `app/api/builder/workflows/route.ts`, `app/api/builder/workflows/create/route.ts`, `app/api/builder/workflows/current/route.ts`, `app/api/builder/workflows/executions/[executionId]/logs/route.ts`, `app/api/builder/workflows/[workflowId]/route.ts`, `app/api/builder/workflows/[workflowId]/duplicate/route.ts`, `app/api/builder/workflows/[workflowId]/download/route.ts`, `app/api/builder/workflows/[workflowId]/publish/route.ts`, `app/api/builder/workflows/[workflowId]/rollback/route.ts`, `app/api/builder/workflows/[workflowId]/run/route.ts`, `app/api/builder/workflows/[workflowId]/webhook/route.ts`

**Interfaces:**
- Consumes: `getTenantContext()` (Fase 2A), as 7 funções de `workflow-db.ts` (Task 10).

**Padrão mecânico (idêntico ao já usado em toda a Fase 2A, Task 6):**

```typescript
import { getTenantContext } from '@/lib/tenant-context'
// ...
const ctx = await getTenantContext()
if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
// ...
const record = await ensureWorkflowRecord(supabase, ctx.tenantId, workflowId, companyId)
```

- [ ] **Step 1: Corrigir cada um dos 11 arquivos**

Para cada arquivo: adicionar `getTenantContext()` logo após a checagem de auth/sessão já existente (se houver — a maioria dessas rotas já é dashboard-only); passar `ctx.tenantId` como 2º argumento em toda chamada a `ensureWorkflowRecord`, `createWorkflowRecord`, `updateWorkflowRecord`, `listWorkflowRecords`, `createNewVersion`, `getCompanyId`, `fetchWorkflowRecord`.

- [ ] **Step 2: `npx tsc --noEmit`**

Run: `npx tsc --noEmit 2>&1 | grep "app/api/builder"`
Expected: vazio (exceto os 2 handlers `execute`/`resume`, corrigidos na Task 12).

- [ ] **Step 3: Suíte completa**

Run: `npx vitest run`
Expected: sem regressão sobre o baseline acumulado das tasks anteriores. Ajustar mocks de teste existentes desses 11 arquivos, se houver, para passar `tenantId`.

- [ ] **Step 4: Commit**

```bash
git add app/api/builder/workflows/
git commit -m "feat(2B): 11 rotas de workflows escopadas por tenant (getTenantContext + workflow-db.ts)"
```

---

### Task 12: Handlers `execute`/`resume` — derivar tenant do recurso (sem sessão)

**Files:**
- Modify: `app/api/builder/workflow/[workflowId]/execute/route.ts`, `app/api/builder/workflow/[workflowId]/resume/route.ts`

**Interfaces:**
- Consumes: `workflows.tenant_id` (query direta, mesmo padrão do fix de `campaign/workflow` na Fase 2A).

**Contexto:** estes dois são handlers `serve()` do Upstash Workflow, chamados tanto pelo browser (via `lib/builder/api-client.ts`, que não tem acesso a `getTenantContext()` — roda client-side) quanto por QStash (agendamento via `lib/builder/workflow-schedule.ts`) quanto pelo webhook Meta (`app/api/webhook/route.ts`). Nenhum desses caminhos tem sessão de usuário disponível dentro do handler. Como o `workflowId` só existe se o workflow já foi criado antes (via uma das 11 rotas com sessão da Task 11), o `tenantId` é sempre derivável da linha existente em `workflows`.

- [ ] **Step 1: `app/api/builder/workflow/[workflowId]/execute/route.ts`**

Adicionar, logo após `const { workflowId, input } = context.requestPayload;`:

```typescript
  const tenantId = await context.run("resolve-tenant", async () => {
    const { data, error } = await supabase
      .from("workflows")
      .select("tenant_id")
      .eq("id", workflowId)
      .single();
    if (error || !data?.tenant_id) {
      throw new Error(`Workflow ${workflowId} não encontrado ou sem tenant_id`);
    }
    return data.tenant_id as string;
  });
```

Trocar toda chamada a `ensureWorkflowRecord(supabase, workflowId, companyId)` por `ensureWorkflowRecord(supabase, tenantId, workflowId, companyId)` (e demais funções de `workflow-db.ts` usadas no arquivo, se houver mais alguma).

**Nota sobre `getCompanyId`:** este handler chama `getCompanyId(supabase)` (sem `tenantId`, hoje) — após a Task 10, a assinatura exige `tenantId`. Trocar para `getCompanyId(supabase, tenantId)`, usando o `tenantId` já resolvido acima.

- [ ] **Step 2: `app/api/builder/workflow/[workflowId]/resume/route.ts`**

Mesmo padrão do Step 1 — ler o arquivo (`context.requestPayload` já tem `workflowId`), adicionar o mesmo bloco `context.run("resolve-tenant", ...)` logo após a desestruturação do payload, e propagar `tenantId` para as chamadas de `workflow-db.ts` existentes no arquivo.

- [ ] **Step 3: `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: limpo em todo o repo (nenhum call-site de `workflow-db.ts` restante sem `tenantId`).

- [ ] **Step 4: Suíte completa**

Run: `npx vitest run`
Expected: sem regressão.

- [ ] **Step 5: Commit**

```bash
git add "app/api/builder/workflow/[workflowId]/execute/route.ts" "app/api/builder/workflow/[workflowId]/resume/route.ts"
git commit -m "fix(2B): execute/resume derivam tenant de workflows.tenant_id (sem sessão, mesmo padrão do fix de campaign/workflow na 2A)"
```

---

### Task 13: Teste de integração — isolamento de tenant nos webhooks

**Files:**
- Create: `tests/integration/webhook-tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `upsertWhatsAppPhoneNumber`, `resolveTenantByPhoneNumberId` (Task 2); `resolveTenantByChannelToken` (Task 7); banco Supabase real (`vdgudeijxxbaghqaxpip`).

- [ ] **Step 1: Escrever o teste**

```typescript
// tests/integration/webhook-tenant-isolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getSupabaseAdmin } from '@/lib/supabase'
import { upsertWhatsAppPhoneNumber, resolveTenantByPhoneNumberId, clearWhatsAppPhoneNumber } from '@/lib/whatsapp-phone-numbers'

const hasEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY
const maybeIt = hasEnv ? it : it.skip

describe('webhook tenant isolation (integração — requer rede real)', () => {
  let tenantAId: string
  let tenantBId: string

  beforeAll(async () => {
    if (!hasEnv) return
    const db = getSupabaseAdmin()!
    const { data: a } = await db.from('tenants').insert({ name: 'wh-isolation-a', slug: `wh-isolation-a-${Date.now()}` }).select('id').single()
    const { data: b } = await db.from('tenants').insert({ name: 'wh-isolation-b', slug: `wh-isolation-b-${Date.now()}` }).select('id').single()
    tenantAId = a!.id
    tenantBId = b!.id
  })

  afterAll(async () => {
    if (!hasEnv) return
    const db = getSupabaseAdmin()!
    await clearWhatsAppPhoneNumber(tenantAId).catch(() => {})
    await clearWhatsAppPhoneNumber(tenantBId).catch(() => {})
    await db.from('tenants').delete().in('id', [tenantAId, tenantBId])
  })

  maybeIt('phone_number_id resolve para o tenant correto e reconfiguração transfere posse', async () => {
    const phoneNumberId = `pn_isolation_${Date.now()}`
    await upsertWhatsAppPhoneNumber(tenantAId, { phoneNumberId })
    expect(await resolveTenantByPhoneNumberId(phoneNumberId)).toBe(tenantAId)

    // Reconfiguração por outro tenant transfere a posse (comportamento desejado)
    await upsertWhatsAppPhoneNumber(tenantBId, { phoneNumberId })
    expect(await resolveTenantByPhoneNumberId(phoneNumberId)).toBe(tenantBId)
  })

  maybeIt('phone_number_id desconhecido não resolve nenhum tenant', async () => {
    expect(await resolveTenantByPhoneNumberId(`pn_nunca_existiu_${Date.now()}`)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar**

Run: `npx vitest run tests/integration/webhook-tenant-isolation.test.ts`
Expected: se `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY` não estiverem no ambiente, os testes aparecem como `skipped` (não `failed`) — documentar isso no relatório da task, mesma limitação já registrada no teste de isolamento da Fase 2A (Task 12). Se as env vars estiverem presentes, ambos os testes devem passar.

- [ ] **Step 3: `.gitignore` — confirmar que `tests/integration/` já tem exceção (deve ter, da Fase 2A Task 12)**

Run: `grep -n "tests/integration" .gitignore`
Expected: exceção já existe. Se não existir, adicionar `!tests/integration/webhook-tenant-isolation.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/webhook-tenant-isolation.test.ts
git commit -m "test(2B): isolamento de tenant no mapeamento phone_number_id -> tenant_id"
```

---

### Task 14: Suíte completa, `get_advisors` final, atualizar runbook

**Files:**
- Modify: `docs/superpowers/runbooks/2026-07-09-cutover-fase2a.md` (ou criar `docs/superpowers/runbooks/2026-07-10-cutover-fase2b.md`, decidir na hora — se o runbook da 2A ainda estiver fresco e as tasks desta fase forem um complemento direto, preferir uma seção nova nele em vez de um arquivo separado, para não fragmentar o runbook do cutover).

- [ ] **Step 1: Rodar `mcp__supabase__get_advisors` (security + performance) contra o estado final do banco**

Corrigir qualquer finding novo introduzido pelas Tasks 1-13 (não findings pré-existentes de tabelas de domínio, já conhecidos e registrados no ledger da 2A).

- [ ] **Step 2: `npx tsc --noEmit && npx build && npx vitest run` — suíte completa**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: tsc limpo, build ok, vitest sem nenhum failed (comparar contagem total com o baseline de entrada desta fase: 3430 passed, 4 skipped + todos os testes novos das Tasks 2-9 e 13).

- [ ] **Step 3: Atualizar o runbook**

Adicionar uma seção cobrindo: (a) as duas tabelas novas e como popular manualmente `whatsapp_phone_numbers`/`google_calendar_channels` para tenants que já tinham credenciais salvas antes desta fase (script de backfill — se necessário, ver Step 4); (b) o passo de onboarding "colar a URL do endpoint de Flows com token" que fica pendente para a Fase 3; (c) a mudança de `webhook_verify_token` para configuração de plataforma — se o ambiente de produção já tinha um token salvo per-tenant antes desta fase, ele precisa ser migrado manualmente para `platform_settings` (ou simplesmente deixar gerar um novo, já que o handshake do Meta é reconfigurável no App Dashboard).

- [ ] **Step 4: Avaliar necessidade de backfill (decisão, não script obrigatório)**

Se o ambiente de produção/staging já tiver tenants com credenciais WhatsApp salvas em `settings` ANTES desta fase rodar, `whatsapp_phone_numbers` estará vazia para eles (o write-through só dispara em saves novos) — o webhook ficaria "ignorado" para esses números até uma resalvagem manual das credenciais. Registrar essa lacuna no runbook como ação manual pós-deploy (resalvar credenciais de cada tenant existente uma vez), já que o volume de tenants nesta fase do produto é baixo o suficiente para não justificar um script de backfill dedicado (YAGNI) — reavaliar se a base crescer antes do cutover real.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/runbooks/
git commit -m "docs(2B): runbook — backfill de whatsapp_phone_numbers, migração de webhook_verify_token, onboarding do token de Flows"
```

---

## Notas de execução

- **Tasks 1-2 são pré-requisito de tudo o resto** (schema + helpers). Tasks 3-9 são paralelizáveis entre si depois disso (arquivos distintos, sem dependência cruzada) — exceto Task 6 e Task 5, que tocam o mesmo arquivo (`app/api/webhook/route.ts`) e devem rodar em sequência para evitar conflito.
- **Task 10 é pré-requisito das Tasks 11 e 12** (muda a assinatura que as duas outras corrigem downstream).
- **Task 8 é pré-requisito da Task 9** (a rota precisa existir com o parâmetro `token` antes de qualquer lugar apontar pra ela).
- Ordem recomendada: 1 → 2 → (3, 4, 5→6, 7, 8→9 em paralelo) → 10 → (11, 12 em paralelo) → 13 → 14.
- Ao final, rodar o mesmo pre-flight de qualquer fase anterior antes de considerar mergeável: `tsc` limpo, build ok, suíte completa verde, advisors limpos.
