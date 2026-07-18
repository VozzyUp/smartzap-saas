# Fase 4 — Múltiplos números WhatsApp por tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vários números WhatsApp por tenant (limitados pelo plano), com modelo de "número ativo": envios novos usam o ativo, respostas do inbox usam o número da própria conversa.

**Architecture:** A tabela `whatsapp_phone_numbers` (PK `phone_number_id text`) vira a fonte de verdade por número (ganha `access_token`, `display_label`, `is_active`). O número ativo é espelhado em `settings` para compat com as 47 leituras legadas de `getWhatsAppCredentials` e `isWhatsAppConnected`. Novas rotas `/api/whatsapp-numbers` gerenciam CRUD + ativação, com gate de plano. O inbox grava o número na conversa e responde por ele.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + service role), TypeScript, Vitest, React Query, sonner.

## Global Constraints

- `getWhatsAppCredentials(tenantId)` mantém assinatura e retorno (`{ phoneNumberId, businessAccountId, accessToken } | null`). Nenhum dos 47 call-sites muda.
- Migração **não-destrutiva/reversível**: sem linha ativa, comportamento idêntico ao de hoje (lê `settings`). `settings` nunca é apagado.
- Exatamente **1 número ativo por tenant** (índice único parcial `WHERE is_active`).
- `access_token` nunca é serializado para o client. Rotas de listagem retornam só `{ phone_number_id, display_label, is_active, business_account_id?, display_phone_number? }` — nunca token.
- Todo acesso resolve o tenant via `getTenantContext`; operações escopadas por `tenant_id` (nunca tocam número de outro tenant, mesmo com `phone_number_id` arbitrário no path).
- Gate reusa `canAddWhatsAppNumber` + `planLimitResponse` de `lib/plan-limits` (não duplicar).
- Migração versionada em `supabase/migrations/` E aplicada via MCP (Supabase `apply_migration`).
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-4-multiplos-numeros` (já criada a partir de `main`).
- Agentes commitam com `git commit -m "..." -- <arquivos>` (paths explícitos, evita race no índice).

## File Structure

- `supabase/migrations/<ts>_multi_numbers.sql` — colunas, índice, FK inbox, GRANT por coluna, backfill. (T1)
- `lib/whatsapp-phone-numbers.ts` — camada de números (novas funções + fix flows token). (T2)
- `lib/whatsapp-phone-numbers.test.ts` — testes da camada (arquivo já existe, estender). (T2)
- `lib/whatsapp-credentials.ts` — leitura ativa-first + `getWhatsAppCredentialsForNumber`. (T3)
- `lib/whatsapp-credentials.test.ts` — testes (criar). (T3)
- `app/api/settings/credentials/route.ts` — POST/DELETE passam a escrever token+ativo na tabela e espelhar. (T4)
- `lib/inbox/inbox-service.ts` + webhook create-conversation — grava e usa `whatsapp_number_id`. (T5)
- `app/api/whatsapp-numbers/route.ts`, `[id]/route.ts`, `[id]/activate/route.ts` — CRUD. (T6)
- `app/(dashboard)/settings/numeros/page.tsx` + menu — UI. (T7)
- `docs/superpowers/runbooks/2026-07-17-fase4-multiplos-numeros.md` — runbook. (T8)

---

### Task 1: Schema — colunas, índice, FK, GRANT por coluna, backfill

**Files:**
- Create: `supabase/migrations/20260718000001_multi_numbers.sql`

**Interfaces:**
- Produces: colunas `whatsapp_phone_numbers.access_token`, `.display_label`, `.is_active`; índice `uq_wa_active_per_tenant`; coluna `inbox_conversations.whatsapp_number_id text` (FK `ON DELETE SET NULL`); GRANT por coluna sem `access_token`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Fase 4: múltiplos números WhatsApp por tenant. whatsapp_phone_numbers passa a
-- guardar credenciais por número + número ativo. Não-destrutivo: sem is_active,
-- getWhatsAppCredentials continua lendo settings (fallback).
begin;

alter table public.whatsapp_phone_numbers
  add column if not exists access_token text,
  add column if not exists display_label text,
  add column if not exists is_active boolean not null default false;

-- No máximo 1 número ativo por tenant.
create unique index if not exists uq_wa_active_per_tenant
  on public.whatsapp_phone_numbers (tenant_id) where is_active;

-- Conversa "pertence" ao número em que chegou (nullable; antigas = null → ativo).
alter table public.inbox_conversations
  add column if not exists whatsapp_number_id text
  references public.whatsapp_phone_numbers(phone_number_id) on delete set null;

-- Segurança por coluna: access_token ilegível via PostgREST (mesmo p/ o próprio
-- tenant); só service role o lê. INSERT/UPDATE/DELETE seguem concedidos.
revoke select on public.whatsapp_phone_numbers from authenticated;
grant select (phone_number_id, tenant_id, business_account_id, display_label,
  is_active, flows_webhook_token, created_at, updated_at)
  on public.whatsapp_phone_numbers to authenticated;

-- Backfill: o número atual de cada tenant (em settings) vira a linha ativa.
-- AJUSTAR conforme o schema real de settings (ver Step 2 antes de aplicar).
with cur as (
  select
    s_pn.tenant_id,
    s_pn.value  as phone_number_id,
    s_ba.value  as business_account_id,
    s_at.value  as access_token
  from public.settings s_pn
  left join public.settings s_ba
    on s_ba.tenant_id = s_pn.tenant_id and s_ba.key = 'businessAccountId'
  left join public.settings s_at
    on s_at.tenant_id = s_pn.tenant_id and s_at.key = 'accessToken'
  where s_pn.key = 'phoneNumberId'
    and coalesce(s_pn.value, '') <> ''
)
insert into public.whatsapp_phone_numbers
  (phone_number_id, tenant_id, business_account_id, access_token, is_active, updated_at)
select cur.phone_number_id, cur.tenant_id, cur.business_account_id, cur.access_token, true, now()
from cur
on conflict (phone_number_id) do update
  set business_account_id = coalesce(public.whatsapp_phone_numbers.business_account_id, excluded.business_account_id),
      access_token        = coalesce(public.whatsapp_phone_numbers.access_token, excluded.access_token),
      is_active           = true,
      updated_at          = now();

commit;
```

- [ ] **Step 2: Confirmar a forma real da tabela `settings`**

Antes de aplicar, verificar como `settings` guarda as chaves. O código usa `settingsDb.getAll(tenantId)` que retorna `{ phoneNumberId, businessAccountId, accessToken, isConnected }`. Ler `lib/supabase-db.ts` (`settingsDb`) para confirmar se é key/value (`settings(tenant_id, key, value)`) ou colunas. **Se o schema divergir do backfill acima, ajustar a CTE `cur` para o schema real** (mesma intenção: para cada tenant com `phoneNumberId` não-vazio, criar/atualizar a linha da tabela como ativa com o token). Não aplicar a migração com um backfill que não corresponde ao schema.

- [ ] **Step 3: Aplicar via MCP**

Aplicar com Supabase `apply_migration` (name: `multi_numbers`). Depois `execute_sql` para confirmar: colunas novas presentes; `select count(*) from whatsapp_phone_numbers where is_active` = nº de tenants com número; `inbox_conversations` tem `whatsapp_number_id`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fase4): schema multi-numeros (colunas, indice ativo, FK inbox, grant por coluna, backfill)" -- supabase/migrations/20260718000001_multi_numbers.sql
```

---

### Task 2: Camada de números (`lib/whatsapp-phone-numbers.ts`)

**Files:**
- Modify: `lib/whatsapp-phone-numbers.ts`
- Test: `lib/whatsapp-phone-numbers.test.ts` (já existe — estender, seguir o harness de mock atual do arquivo)

**Interfaces:**
- Consumes: `getSupabaseAdmin()` de `@/lib/supabase` (service role — bypassa RLS/GRANT, lê `access_token`).
- Produces:
  - `type WhatsAppNumberRow = { phone_number_id: string; tenant_id: string; business_account_id: string | null; access_token: string | null; display_label: string | null; is_active: boolean }`
  - `type WhatsAppNumberPublic = Omit<WhatsAppNumberRow, 'access_token'>`
  - `getActiveWhatsAppNumber(tenantId): Promise<WhatsAppNumberRow | null>`
  - `getWhatsAppNumberByPhoneId(tenantId, phoneNumberId): Promise<WhatsAppNumberRow | null>`
  - `listWhatsAppNumbers(tenantId): Promise<WhatsAppNumberPublic[]>`
  - `addWhatsAppNumber(tenantId, { phoneNumberId, businessAccountId, accessToken, displayLabel }): Promise<WhatsAppNumberRow>`
  - `setActiveWhatsAppNumber(tenantId, phoneNumberId): Promise<void>`
  - `removeWhatsAppNumber(tenantId, phoneNumberId): Promise<void>`
  - `getOrCreateFlowsWebhookToken` mantém assinatura, mas opera sobre a linha ativa.

- [ ] **Step 1: Escrever testes falhando**

Seguindo o harness de mock já presente em `lib/whatsapp-phone-numbers.test.ts` (mock de `getSupabaseAdmin`), adicionar:
- `addWhatsAppNumber`: sem nenhuma linha → inserida `is_active=true`; já tendo uma ativa → nova `is_active=false`.
- `getActiveWhatsAppNumber`: filtra `tenant_id` + `is_active=true`, `maybeSingle`.
- `getWhatsAppNumberByPhoneId`: filtra `tenant_id` + `phone_number_id` (número de outro tenant → null).
- `listWhatsAppNumbers`: projeção sem `access_token`.
- `setActiveWhatsAppNumber`: update zera `is_active` do tenant + update liga o escolhido.
- `removeWhatsAppNumber`: deleta; se removida era ativa e sobra outra, promove uma.
- `getOrCreateFlowsWebhookToken`: agora filtra `is_active=true` (ajustar testes existentes que assumiam só `.eq('tenant_id')`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/whatsapp-phone-numbers.test.ts`
Expected: FAIL (funções inexistentes / assinatura antiga).

- [ ] **Step 3: Implementar**

```typescript
export type WhatsAppNumberRow = {
  phone_number_id: string
  tenant_id: string
  business_account_id: string | null
  access_token: string | null
  display_label: string | null
  is_active: boolean
}
export type WhatsAppNumberPublic = Omit<WhatsAppNumberRow, 'access_token'>

const PUBLIC_COLS = 'phone_number_id, tenant_id, business_account_id, display_label, is_active'
const FULL_COLS = `${PUBLIC_COLS}, access_token`

export async function getActiveWhatsAppNumber(tenantId: string): Promise<WhatsAppNumberRow | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db.from('whatsapp_phone_numbers').select(FULL_COLS)
    .eq('tenant_id', tenantId).eq('is_active', true).maybeSingle()
  return (data as WhatsAppNumberRow) ?? null
}

export async function getWhatsAppNumberByPhoneId(tenantId: string, phoneNumberId: string): Promise<WhatsAppNumberRow | null> {
  const db = getSupabaseAdmin()!
  const { data } = await db.from('whatsapp_phone_numbers').select(FULL_COLS)
    .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId).maybeSingle()
  return (data as WhatsAppNumberRow) ?? null
}

export async function listWhatsAppNumbers(tenantId: string): Promise<WhatsAppNumberPublic[]> {
  const db = getSupabaseAdmin()!
  const { data } = await db.from('whatsapp_phone_numbers').select(PUBLIC_COLS)
    .eq('tenant_id', tenantId).order('created_at', { ascending: true })
  return (data as WhatsAppNumberPublic[]) ?? []
}

export async function addWhatsAppNumber(
  tenantId: string,
  params: { phoneNumberId: string; businessAccountId?: string | null; accessToken: string; displayLabel?: string | null }
): Promise<WhatsAppNumberRow> {
  const db = getSupabaseAdmin()!
  const existingActive = await getActiveWhatsAppNumber(tenantId)
  const { data, error } = await db.from('whatsapp_phone_numbers').upsert(
    {
      phone_number_id: params.phoneNumberId,
      tenant_id: tenantId,
      business_account_id: params.businessAccountId ?? null,
      access_token: params.accessToken,
      display_label: params.displayLabel ?? null,
      is_active: existingActive === null, // 1º número do tenant já entra ativo
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone_number_id' }
  ).select(FULL_COLS).single()
  if (error) throw error
  return data as WhatsAppNumberRow
}

export async function setActiveWhatsAppNumber(tenantId: string, phoneNumberId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  const off = await db.from('whatsapp_phone_numbers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('is_active', true)
  if (off.error) throw off.error
  const on = await db.from('whatsapp_phone_numbers')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId)
  if (on.error) throw on.error
}

export async function removeWhatsAppNumber(tenantId: string, phoneNumberId: string): Promise<void> {
  const db = getSupabaseAdmin()!
  const target = await getWhatsAppNumberByPhoneId(tenantId, phoneNumberId)
  const del = await db.from('whatsapp_phone_numbers').delete()
    .eq('tenant_id', tenantId).eq('phone_number_id', phoneNumberId)
  if (del.error) throw del.error
  if (target?.is_active) {
    const { data } = await db.from('whatsapp_phone_numbers').select('phone_number_id')
      .eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (data?.phone_number_id) await setActiveWhatsAppNumber(tenantId, data.phone_number_id)
  }
}
```

Ajustar `getOrCreateFlowsWebhookToken` para operar sobre a linha ativa (o SELECT inicial e o UPDATE ganham `.eq('is_active', true)`):

```typescript
const { data } = await db.from('whatsapp_phone_numbers').select('flows_webhook_token')
  .eq('tenant_id', tenantId).eq('is_active', true).maybeSingle()
// ... e o UPDATE que grava o token idem com .eq('is_active', true)
```

Manter `upsertWhatsAppPhoneNumber`, `resolveTenantByPhoneNumberId`, `resolveTenantByFlowsWebhookToken`, `clearWhatsAppPhoneNumber` com as assinaturas atuais.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/whatsapp-phone-numbers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase4): camada de multiplos numeros (add/list/setActive/remove + flows token no ativo)" -- lib/whatsapp-phone-numbers.ts lib/whatsapp-phone-numbers.test.ts
```

---

### Task 3: Leitura de credenciais ativa-first + por número

**Files:**
- Modify: `lib/whatsapp-credentials.ts`
- Test: `lib/whatsapp-credentials.test.ts` (criar)

**Interfaces:**
- Consumes: `getActiveWhatsAppNumber`, `getWhatsAppNumberByPhoneId` (Task 2); `settingsDb.getAll` (existente).
- Produces: `getWhatsAppCredentials(tenantId)` (retorno inalterado); `getWhatsAppCredentialsForNumber(tenantId, phoneNumberId: string | null): Promise<WhatsAppCredentials | null>`.

- [ ] **Step 1: Escrever testes falhando**

Mock de `@/lib/whatsapp-phone-numbers` e `@/lib/supabase-db`:
- `getWhatsAppCredentials`: ativo com token → retorna credenciais do ativo (não lê settings).
- `getWhatsAppCredentials`: ativo null → **fallback** settings.
- `getWhatsAppCredentials`: ativo sem `access_token` (parcial) → fallback settings.
- `getWhatsAppCredentialsForNumber(tenant, 'pn_2')` → credenciais de `pn_2`.
- `getWhatsAppCredentialsForNumber(tenant, null)` → delega a `getWhatsAppCredentials`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/whatsapp-credentials.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
import { settingsDb } from '@/lib/supabase-db'
import { getActiveWhatsAppNumber, getWhatsAppNumberByPhoneId } from '@/lib/whatsapp-phone-numbers'

function rowToCreds(row: { phone_number_id: string; business_account_id: string | null; access_token: string | null }): WhatsAppCredentials | null {
  if (row.phone_number_id && row.business_account_id && row.access_token) {
    return { phoneNumberId: row.phone_number_id, businessAccountId: row.business_account_id, accessToken: row.access_token }
  }
  return null
}

export async function getWhatsAppCredentials(tenantId: string): Promise<WhatsAppCredentials | null> {
  try {
    const active = await getActiveWhatsAppNumber(tenantId)
    if (active) {
      const creds = rowToCreds(active)
      if (creds) return creds
    }
    const settings = await settingsDb.getAll(tenantId)
    const { phoneNumberId, businessAccountId, accessToken } = settings
    if (phoneNumberId && businessAccountId && accessToken) {
      return { phoneNumberId, businessAccountId, accessToken }
    }
    return null
  } catch (error) {
    console.error('Error fetching WhatsApp credentials:', error)
    return null
  }
}

export async function getWhatsAppCredentialsForNumber(
  tenantId: string,
  phoneNumberId: string | null
): Promise<WhatsAppCredentials | null> {
  if (!phoneNumberId) return getWhatsAppCredentials(tenantId)
  try {
    const row = await getWhatsAppNumberByPhoneId(tenantId, phoneNumberId)
    if (row) {
      const creds = rowToCreds(row)
      if (creds) return creds
    }
    return getWhatsAppCredentials(tenantId)
  } catch (error) {
    console.error('Error fetching credentials for number:', error)
    return getWhatsAppCredentials(tenantId)
  }
}
```

Manter `isWhatsAppConfigured` e `isWhatsAppConnected` como estão (leem settings — servidos pelo espelho da Task 4).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/whatsapp-credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase4): getWhatsAppCredentials ativa-first + getWhatsAppCredentialsForNumber (fallback settings)" -- lib/whatsapp-credentials.ts lib/whatsapp-credentials.test.ts
```

---

### Task 4: Espelho ativo→settings + rota de credenciais escreve na tabela

**Files:**
- Modify: `lib/whatsapp-phone-numbers.ts` (add `mirrorActiveToSettings`)
- Modify: `app/api/settings/credentials/route.ts`
- Test: `app/api/settings/credentials/route.test.ts` (já existe — atualizar mocks/asserts)

**Interfaces:**
- Consumes: `addWhatsAppNumber`, `getActiveWhatsAppNumber` (T2); `settingsDb.saveAll` (existente).
- Produces: `mirrorActiveToSettings(tenantId): Promise<void>` — espelha as credenciais do número ativo em `settings` (`phoneNumberId/businessAccountId/accessToken/isConnected=true`); sem ativo, `isConnected=false` e limpa.

- [ ] **Step 1: Escrever testes falhando**

- `mirrorActiveToSettings`: com ativo, chama `settingsDb.saveAll` com as credenciais do ativo e `isConnected:true`; sem ativo, `saveAll` com strings vazias e `isConnected:false`.
- Rota POST `/api/settings/credentials`: após validar na Meta e passar o gate, chama `addWhatsAppNumber` (com `accessToken`) e depois `mirrorActiveToSettings` — assert que o token é gravado na tabela (mock `addWhatsAppNumber`). Atualizar o mock existente `upsertMock`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run app/api/settings/credentials/route.test.ts lib/whatsapp-phone-numbers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `lib/whatsapp-phone-numbers.ts`:

```typescript
export async function mirrorActiveToSettings(tenantId: string): Promise<void> {
  const { settingsDb } = await import('@/lib/supabase-db')
  const active = await getActiveWhatsAppNumber(tenantId)
  if (active && active.phone_number_id && active.access_token) {
    await settingsDb.saveAll(tenantId, {
      phoneNumberId: active.phone_number_id,
      businessAccountId: active.business_account_id ?? '',
      accessToken: active.access_token,
      isConnected: true,
    })
  } else {
    await settingsDb.saveAll(tenantId, {
      phoneNumberId: '', businessAccountId: '', accessToken: '', isConnected: false,
    })
  }
}
```

Em `app/api/settings/credentials/route.ts` POST, substituir o bloco de save (linhas ~150-160) por:

```typescript
await addWhatsAppNumber(ctx.tenantId, { phoneNumberId, businessAccountId, accessToken })
await mirrorActiveToSettings(ctx.tenantId)
```

Importar `addWhatsAppNumber, mirrorActiveToSettings` de `@/lib/whatsapp-phone-numbers` (remover `upsertWhatsAppPhoneNumber` do import se não mais usado no POST). No DELETE, manter o zeramento de settings existente + `clearWhatsAppPhoneNumber` (já deixa sem ativo); não duplicar espelho.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run app/api/settings/credentials/route.test.ts lib/whatsapp-phone-numbers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase4): espelho ativo->settings + rota credentials grava token na tabela" -- lib/whatsapp-phone-numbers.ts app/api/settings/credentials/route.ts app/api/settings/credentials/route.test.ts
```

---

### Task 5: Inbox — grava número na conversa e responde por ele

**Files:**
- Modify: `lib/inbox/inbox-service.ts`
- Modify: webhook de recebimento (`app/api/webhook/route.ts`) + `lib/supabase-db.ts` (`getOrCreateConversation`/`createConversation`)
- Test: teste do reply do inbox (seguir os testes existentes de `inbox-service`)

**Interfaces:**
- Consumes: `getWhatsAppCredentialsForNumber` (T3); metadata `phone_number_id` do payload da Meta.
- Produces: conversas com `whatsapp_number_id`; reply pelo número da conversa.

- [ ] **Step 1: Localizar o ponto de criação de conversa no recebimento**

No webhook, o `phone_number_id` do payload está em `value.metadata.phone_number_id`. Localizar a chamada que cria/obtém a conversa (`getOrCreateConversation`/`createConversation` em `lib/supabase-db.ts` ou `lib/inbox`). Ler esses pontos.

- [ ] **Step 2: Escrever teste falhando (reply usa número da conversa)**

No teste do `inbox-service`, mockar `getWhatsAppCredentialsForNumber` e uma conversa com `whatsapp_number_id: 'pn_2'`; assert que o reply chama `getWhatsAppCredentialsForNumber(tenantId, 'pn_2')` (não `getWhatsAppCredentials(tenantId)`).

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run lib/inbox`
Expected: FAIL.

- [ ] **Step 4: Implementar**

- Persistir `whatsapp_number_id` na criação da conversa: adicionar parâmetro opcional `whatsappNumberId?: string | null` a `getOrCreateConversation`/`createConversation` e gravá-lo na coluna. No webhook, passar o `phone_number_id` do metadata.
- Em `lib/inbox/inbox-service.ts` (linha ~130), trocar `getWhatsAppCredentials(tenantId)` por `getWhatsAppCredentialsForNumber(tenantId, conversation.whatsapp_number_id ?? null)`. Importar de `@/lib/whatsapp-credentials`. Incluir `whatsapp_number_id` na projeção do SELECT que carrega a conversa.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/inbox` + `npx vitest run` (sem regressão nos testes de webhook)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(fase4): inbox grava whatsapp_number_id e responde pelo numero da conversa" -- lib/inbox/inbox-service.ts lib/supabase-db.ts app/api/webhook/route.ts
```

---

### Task 6: Rotas `/api/whatsapp-numbers`

**Files:**
- Create: `app/api/whatsapp-numbers/route.ts` (GET list, POST add)
- Create: `app/api/whatsapp-numbers/[id]/route.ts` (DELETE)
- Create: `app/api/whatsapp-numbers/[id]/activate/route.ts` (POST)
- Test: `app/api/whatsapp-numbers/route.test.ts`

**Interfaces:**
- Consumes: `getTenantContext`; `listWhatsAppNumbers`, `addWhatsAppNumber`, `setActiveWhatsAppNumber`, `removeWhatsAppNumber`, `mirrorActiveToSettings` (T2/T4); `canAddWhatsAppNumber`, `planLimitResponse`; validação Meta (`fetchWithTimeout`/`safeJson`).

- [ ] **Step 1: Escrever testes falhando**

- GET sem sessão → 401; com sessão → `listWhatsAppNumbers` (sem token no payload).
- POST no limite (mock `canAddWhatsAppNumber` → `{allowed:false}`) → 403 `plan_limit` via `planLimitResponse`.
- POST válido → valida Meta (mock ok) → `addWhatsAppNumber` + `mirrorActiveToSettings` → 200.
- activate → `setActiveWhatsAppNumber` + `mirrorActiveToSettings`.
- DELETE → `removeWhatsAppNumber` + `mirrorActiveToSettings`, escopado ao tenant.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run app/api/whatsapp-numbers/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`route.ts` (GET/POST):

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listWhatsAppNumbers, addWhatsAppNumber, mirrorActiveToSettings } from '@/lib/whatsapp-phone-numbers'
import { canAddWhatsAppNumber, planLimitResponse } from '@/lib/plan-limits'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ numbers: await listWhatsAppNumbers(ctx.tenantId) })
}

export async function POST(request: NextRequest) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const { phoneNumberId, businessAccountId, accessToken, displayLabel } = body ?? {}
  if (!phoneNumberId || !businessAccountId || !accessToken) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const test = await fetchWithTimeout(
    `https://graph.facebook.com/v24.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 8000 }
  )
  if (!test.ok) {
    const e = await safeJson<any>(test)
    return NextResponse.json({ error: 'Invalid credentials', details: e?.error?.message }, { status: 401 })
  }
  if (!ctx.isPlatformAdmin) {
    const gate = await canAddWhatsAppNumber(ctx.tenantId)
    if (!gate.allowed) return planLimitResponse('whatsapp_numbers', gate)
  }
  await addWhatsAppNumber(ctx.tenantId, { phoneNumberId, businessAccountId, accessToken, displayLabel })
  await mirrorActiveToSettings(ctx.tenantId)
  return NextResponse.json({ success: true })
}
```

> **Nota (para o review):** `canAddWhatsAppNumber` conta as linhas do tenant. Como reconectar o mesmo `phone_number_id` é upsert (não adiciona linha), checar o gate antes é aceitável; se reconectar no limite bloquear indevidamente, adotar a checagem "número novo" da rota credentials (`resolveTenantByPhoneNumberId !== tenantId`). Decisão para o review.

`[id]/activate/route.ts`:

```typescript
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  await setActiveWhatsAppNumber(ctx.tenantId, id)
  await mirrorActiveToSettings(ctx.tenantId)
  return NextResponse.json({ success: true })
}
```

`[id]/route.ts` DELETE análogo com `removeWhatsAppNumber` + `mirrorActiveToSettings`. (Next 16: `params` é `Promise` — `await params`.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run app/api/whatsapp-numbers/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase4): rotas /api/whatsapp-numbers (list/add/activate/delete) com gate de plano" -- app/api/whatsapp-numbers/
```

---

### Task 7: UI — Configurações › Números

**Files:**
- Create: `app/(dashboard)/settings/numeros/page.tsx`
- Modify: componente de navegação de Configurações (adicionar "Números de WhatsApp")

**Interfaces:**
- Consumes: `GET/POST /api/whatsapp-numbers`, `[id]/activate`, `DELETE`; `formatPlanLimit`/`getPlanLimitBody` de `lib/plan-limit-message` (3C); `toast` do sonner; React Query.

- [ ] **Step 1: Página**

Client component com React Query:
- Query `['whatsapp-numbers']` → `GET`. Cards: `display_label || phone_number_id`, badge "Ativo" quando `is_active`, botões "Definir como ativo" (se não ativo) e "Remover".
- "Adicionar número" abre form (phoneNumberId, businessAccountId, accessToken, displayLabel). Submit → `POST`; on 403 `plan_limit`, `toast.error(formatPlanLimit(body))` com ação "Ver meu plano" → `/settings/plano` (reusar o padrão de toast da 3C). On success → invalida query, fecha form, `toast.success`.
- "Definir como ativo" → `POST [id]/activate` → invalida query. "Remover" → `DELETE [id]` (confirm simples) → invalida query.
- **Nunca** renderizar token (a API não o envia).
- Seguir os componentes/estilo de `settings/plano/page.tsx` (3C) para consistência.

- [ ] **Step 2: Menu**

Adicionar "Números de WhatsApp" → `/settings/numeros` no mesmo componente de navegação onde a 3C adicionou "Meu Plano".

- [ ] **Step 3: Verificar build/tsc**

Run: `npx tsc --noEmit` e `npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fase4): tela Configuracoes > Numeros (listar/adicionar/ativar/remover) + menu" -- "app/(dashboard)/settings/numeros/" <arquivo-do-menu>
```

---

### Task 8: Fechamento — suíte, build, runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-07-17-fase4-multiplos-numeros.md`

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run` (sem regressão) + `npx tsc --noEmit` + `npm run build`. Confirmar que os 47 call-sites de `getWhatsAppCredentials` compilam.

- [ ] **Step 2: Runbook**

Documentar: entregue; migração aplicada; smoke test (adicionar 2º número no limite → toast upgrade; trocar ativo; campanha usa o ativo; receber em número B e responder sai de B); rollback (colunas inertes, settings intacto); passo pós-deploy (deploy da imagem sha-<...>).

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(fase4): runbook multiplos numeros" -- docs/superpowers/runbooks/2026-07-17-fase4-multiplos-numeros.md
```

---

## Execução

Camadas para subagentes em paralelo (arquivos disjuntos). Dependências reais:
- **T1 (schema)** — primeiro, sozinho. Migração aplicada via MCP.
- **T2 (camada números)** — após T1 (define os tipos/funções que quase tudo consome).
- Após T2, em paralelo: **T3 (credenciais)** ∥ **T5 (inbox)**.
- **T4 (espelho + rota credentials)** — após T3 (adiciona `mirrorActiveToSettings` a `lib/whatsapp-phone-numbers.ts`; edita o mesmo arquivo da T2, então sequencial a ela).
- **T6 (rotas)** — após T4 (importa `mirrorActiveToSettings`).
- **T7 (UI)** — após T6 (consome as rotas).
- **T8 (fechamento)** — por último.

Ou seja, o único paralelismo seguro é **T3 ∥ T5** (arquivos disjuntos, ambos só dependem de T2). O resto é sequencial por dependência de símbolo/arquivo. Cada agente usa `git commit -m "..." -- <arquivos>` (paths explícitos). Review por camada; review final de branch inteira antes do merge.

Cada agente usa `git commit -m "..." -- <arquivos>` (paths explícitos). Review por camada; review final de branch inteira antes do merge.
