# Fase 2C — Auditoria de Tenant-Scoping das Rotas Diretas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que nenhuma rota de `app/api` consulte tabela de domínio via Supabase direto sem escopar por tenant — fechando crashes (`.single()` sobre a PK composta `(tenant_id, key)` de `settings`) e vazamentos cross-tenant (IDOR via `getSupabaseAdmin`, que bypassa RLS).

**Architecture:** Aplicar um de 4 padrões de resolução de tenant a cada rota, conforme seu modelo de auth: (A) sessão de owner via `getTenantContext()`; (B) token de atendente via novo `resolveTenantByAttendantToken()`; (C) platform admin via `ctx.isPlatformAdmin`; (D) intocado (ping de conectividade). O padrão foi validado na Fase 2A/2B; esta fase o estende às ~24 rotas que usaram Supabase direto e escaparam do escopo mecânico anterior.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), TypeScript, Vitest.

## Global Constraints

- Nenhuma rota de `app/api` pode ler/escrever tabela de domínio sem um `tenant_id` resolvido. Preferir `settingsDb`/`*Db` (já tenant-scoped) a query direta; onde a query direta for inevitável, `.eq('tenant_id', tenantId)` em selects/updates/deletes e `tenant_id` em inserts.
- Config de IA (`google_api_key`, `openai_api_key`, providers, toggles) é **por-tenant** (`settingsDb`), não de plataforma.
- `.single()` sobre tabela com PK/UNIQUE composta que inclui `tenant_id` só é seguro **com** `.eq('tenant_id', ...)`; onde "não existe" é caso normal, trocar `.single()` por `.maybeSingle()`.
- Testes: Vitest. Baseline (HEAD `d898a06` em `main`): `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` = 3448 passed, 6 skipped. Cada task roda a suíte completa antes de commitar, sem regressão.
- Testes de rota que importam módulos com `import "server-only"` (transitividade via `lib/builder/*`) devem mockar esse módulo — `server-only` lança fora do build do Next (ver `app/api/webhook/route.test.ts` para o padrão de mock).
- Branch: `saas/fase-2c-tenant-audit`, criada a partir de `main`.
- Fora de escopo: `app/api/installer/*`, `lib/user-auth.ts` (MASTER_PASSWORD, pré-tenant); já corrigido em `d898a06`: `settings/onboarding`, `settings/ai-agents-toggle`, `ai/models`.

## Convenções — os 4 padrões (referência para todas as tasks)

### Padrão A — Sessão de owner
```ts
import { getTenantContext } from '@/lib/tenant-context'
// no início do handler:
const ctx = await getTenantContext()
if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
// depois: settingsDb.get(ctx.tenantId, key) / db.from('X').select().eq('tenant_id', ctx.tenantId) / insert { ..., tenant_id: ctx.tenantId }
```

### Padrão B — Token de atendente (usa o helper da Task 1)
```ts
import { resolveTenantByAttendantToken } from '@/lib/attendant-auth'
const token = new URL(request.url).searchParams.get('token')
const tenantId = await resolveTenantByAttendantToken(token)
if (!tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```

### Padrão A-com-fallback-B — serve owner e atendente
```ts
const ctx = await getTenantContext()
let tenantId = ctx?.tenantId ?? null
if (!tenantId) {
  const token = new URL(request.url).searchParams.get('token')
  tenantId = await resolveTenantByAttendantToken(token)
}
if (!tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```

### Padrão C — Platform admin
```ts
const ctx = await getTenantContext()
if (!ctx?.isPlatformAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
// queries podem ser cross-tenant (é o propósito); só platform_admin acessa
```

### Regra de client
Onde a rota usa `getSupabaseAdmin()` (bypassa RLS) apenas por conveniência mas serve dados de um tenant logado, manter o admin client **mas** adicionar `.eq('tenant_id', tenantId)` explícito em toda query — o filtro na aplicação é o que garante o isolamento, já que o admin ignora RLS. Onde usa `createClient()` (sessão, RLS ativa), o `.eq('tenant_id', ...)` é defesa em profundidade e alinha o resultado com `current_tenant_id()`.

---

## Estrutura de arquivos

**Novo:**
- `lib/attendant-auth.ts` — `resolveTenantByAttendantToken`.
- `lib/attendant-auth.test.ts`.

**Modificar (por lote):**
- Lote A (IA config): `settings/ai`, `ai-agents/embedding-providers`, `ai-agents/llm-providers`, `ai/generate-utility-templates`.
- Lote B (IA agentes): `ai-agents/route.ts`, `ai-agents/[id]/route.ts`, `ai-agents/knowledge/route.ts`, `ai-agents/[id]/chat/route.ts`.
- Lote C (contatos/dashboard): `contacts/country-codes`, `contacts/state-codes`, `contacts/tag-counts`, `contacts/segment-count`, `dashboard/stats`.
- Lote D (templates/flows): `templates/drafts`, `templates/drafts/[id]`, `flows/submissions/report.csv`.
- Lote E (inbox owner): `inbox/conversations/[id]/{handoff,pause,resume,return-to-bot,takeover}`, `inbox/suggest`, `settings/performance`.
- Lote F (atendimento): `attendant/conversations`.
- Lote G (admin/debug): `system`, `debug/ai-logs`, `debug/campaigns/[id]/audit`.
- `health/route.ts` — **não modificar** (Padrão D, documentado auditado).

---

### Task 1: `lib/attendant-auth.ts` — resolver tenant por attendant_token (TDD)

**Files:**
- Create: `lib/attendant-auth.ts`, `lib/attendant-auth.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` (`lib/supabase`), tabela `attendant_tokens(token, tenant_id, is_active, expires_at)`.
- Produces: `resolveTenantByAttendantToken(token: string | null): Promise<string | null>` — retorna `tenant_id` se o token existe, `is_active = true` e (`expires_at` nulo OU no futuro); senão `null`.

- [ ] **Step 1: Escrever o teste falhando**

```typescript
// lib/attendant-auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const selectFn = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      if (t !== 'attendant_tokens') throw new Error(`unexpected table ${t}`)
      return { select: () => ({ eq: () => ({ maybeSingle: selectFn }) }) }
    },
  }),
}))

import { resolveTenantByAttendantToken } from '@/lib/attendant-auth'

describe('resolveTenantByAttendantToken', () => {
  beforeEach(() => selectFn.mockReset())

  it('retorna null para token nulo/vazio (sem ir ao banco)', async () => {
    expect(await resolveTenantByAttendantToken(null)).toBeNull()
    expect(await resolveTenantByAttendantToken('')).toBeNull()
    expect(selectFn).not.toHaveBeenCalled()
  })

  it('retorna tenant_id para token ativo sem expiração', async () => {
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: true, expires_at: null }, error: null })
    expect(await resolveTenantByAttendantToken('tok_valid')).toBe('t1')
  })

  it('retorna tenant_id para token ativo com expiração no futuro', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: true, expires_at: future }, error: null })
    expect(await resolveTenantByAttendantToken('tok_valid')).toBe('t1')
  })

  it('retorna null para token inativo', async () => {
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: false, expires_at: null }, error: null })
    expect(await resolveTenantByAttendantToken('tok_inactive')).toBeNull()
  })

  it('retorna null para token expirado', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString()
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: true, expires_at: past }, error: null })
    expect(await resolveTenantByAttendantToken('tok_expired')).toBeNull()
  })

  it('retorna null para token inexistente', async () => {
    selectFn.mockResolvedValueOnce({ data: null, error: null })
    expect(await resolveTenantByAttendantToken('tok_none')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/attendant-auth.test.ts`
Expected: FAIL — módulo `@/lib/attendant-auth` não existe.

- [ ] **Step 3: Implementar**

```typescript
// lib/attendant-auth.ts
import { getSupabaseAdmin } from '@/lib/supabase'

/**
 * Resolve o tenant de um atendente a partir do seu attendant_token.
 * Ponto de entrada sem sessão de usuário (o atendente acessa /atendimento
 * com ?token=). Usa o admin client porque não há sessão para a RLS avaliar;
 * o isolamento vem da própria validação do token.
 */
export async function resolveTenantByAttendantToken(token: string | null): Promise<string | null> {
  if (!token) return null
  const db = getSupabaseAdmin()
  if (!db) return null

  const { data } = await db
    .from('attendant_tokens')
    .select('tenant_id, is_active, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null
  return data.tenant_id ?? null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/attendant-auth.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/attendant-auth.ts lib/attendant-auth.test.ts
git commit -m "feat(2C): resolveTenantByAttendantToken — resolução de tenant por attendant_token"
```

---

### Task 2: Lote A — IA config (Padrão A, por-tenant)

**Files:** Modify
- `app/api/settings/ai/route.ts` (GET/POST/DELETE — `settings`)
- `app/api/ai-agents/embedding-providers/route.ts` (GET — `settings`)
- `app/api/ai-agents/llm-providers/route.ts` (GET — `settings`)
- `app/api/ai/generate-utility-templates/route.ts` (linha ~373 — lê `settings` via `supabase.admin?.from('settings')`)

**Interfaces:**
- Consumes: `getTenantContext` (Padrão A), `settingsDb.get/set`.

- [ ] **Step 1: Aplicar Padrão A a cada rota**

Para cada arquivo: adicionar `getTenantContext()` no início de cada handler; substituir cada `supabase.admin?.from('settings').select('value').eq('key', K).single()` (ou variação) por `settingsDb.get(ctx.tenantId, K)`, e cada upsert/insert em `settings` por `settingsDb.set(ctx.tenantId, K, V)`. Ler cada arquivo antes de editar para pegar todos os handlers e todas as chaves. `settings/ai` tem GET, POST e DELETE — os três precisam do gate e do escopo. Em `generate-utility-templates`, a leitura de settings (chave de IA) vira `settingsDb.get(ctx.tenantId, ...)`; o resto da rota (geração via LLM) não muda.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -E "settings/ai|embedding-providers|llm-providers|generate-utility"` → vazio.
Run: `npx vitest run` → sem regressão (atualizar mocks de testes existentes desses arquivos, se houver, para passar `tenantId`/mockar `getTenantContext`).

- [ ] **Step 3: Commit**

```bash
git add app/api/settings/ai/route.ts app/api/ai-agents/embedding-providers/route.ts app/api/ai-agents/llm-providers/route.ts app/api/ai/generate-utility-templates/route.ts
git commit -m "fix(2C): lote A — config de IA tenant-scoped (settings/ai, providers, generate-utility)"
```

---

### Task 3: Lote B — IA agentes (Padrão A, múltiplas tabelas)

**Files:** Modify
- `app/api/ai-agents/route.ts` (GET/POST — `ai_agents`; usa helper local `getClient()` = `getSupabaseAdmin`)
- `app/api/ai-agents/[id]/route.ts` (GET/PATCH/DELETE — `ai_agents`, `inbox_conversations`)
- `app/api/ai-agents/knowledge/route.ts` (GET/POST/DELETE — `ai_knowledge_files`, `ai_agents`, `settings`)
- `app/api/ai-agents/[id]/chat/route.ts` (POST — `ai_agents`, `settings`)

**Interfaces:**
- Consumes: `getTenantContext` (Padrão A). Regra de client: mantêm `getSupabaseAdmin`, adicionam `.eq('tenant_id', ctx.tenantId)` em toda query.

- [ ] **Step 1: Aplicar Padrão A a cada rota, escopando TODAS as queries**

Para cada arquivo: `getTenantContext()` no início de cada handler; em **cada** `.from('ai_agents' | 'ai_knowledge_files' | 'inbox_conversations' | ...)`, adicionar `.eq('tenant_id', ctx.tenantId)` nos selects/updates/deletes e `tenant_id: ctx.tenantId` nos inserts. Leituras de `settings` viram `settingsDb.get(ctx.tenantId, ...)`. Atenção especial: `ai-agents/[id]/route.ts` DELETE mexe em `ai_agents` e `inbox_conversations` — ambas escopadas; `knowledge` toca 3 tabelas; `chat` lê `ai_agents` + `settings` (chave de IA). Trocar `.single()` por `.maybeSingle()` onde "agente não encontrado" é um 404 legítimo, não erro.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep "ai-agents"` → vazio.
Run: `npx vitest run` → sem regressão (mockar `server-only` se algum teste puxar `lib/builder/*` transitivamente).

- [ ] **Step 3: Commit**

```bash
git add app/api/ai-agents/route.ts "app/api/ai-agents/[id]/route.ts" app/api/ai-agents/knowledge/route.ts "app/api/ai-agents/[id]/chat/route.ts"
git commit -m "fix(2C): lote B — rotas de agentes IA tenant-scoped (ai_agents, ai_knowledge_files, inbox)"
```

---

### Task 4: Lote C — contatos + dashboard (Padrão A)

**Files:** Modify
- `app/api/contacts/country-codes/route.ts` (`contacts`)
- `app/api/contacts/state-codes/route.ts` (`contacts`)
- `app/api/contacts/tag-counts/route.ts` (`contacts` + `rpc('get_contact_tag_counts')`)
- `app/api/contacts/segment-count/route.ts` (`contacts`)
- `app/api/dashboard/stats/route.ts` (`campaign_stats_summary`, `campaigns`)

**Interfaces:**
- Consumes: `getTenantContext` (Padrão A).

- [ ] **Step 1: Aplicar Padrão A**

`getTenantContext()` + `.eq('tenant_id', ctx.tenantId)` em cada query de `contacts`/`campaigns`. **`tag-counts`**: a RPC `get_contact_tag_counts` foi re-assinada na Fase 2A Task 4b para exigir `p_tenant_id` — passar `{ p_tenant_id: ctx.tenantId }` na chamada `rpc`. **`dashboard/stats`**: `campaign_stats_summary` é uma view (`security_invoker`); confirmar se ela expõe `tenant_id` — se sim, filtrar; se não, trocar por query direta em `campaigns` com `.eq('tenant_id', ...)` OU usar `dashboardDb.getStats(ctx.tenantId)` se cobrir o mesmo dado (verificar na implementação).

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -E "contacts/(country|state|tag|segment)|dashboard/stats"` → vazio.
Run: `npx vitest run` → sem regressão.

- [ ] **Step 3: Commit**

```bash
git add app/api/contacts/country-codes/route.ts app/api/contacts/state-codes/route.ts app/api/contacts/tag-counts/route.ts app/api/contacts/segment-count/route.ts app/api/dashboard/stats/route.ts
git commit -m "fix(2C): lote C — contatos e dashboard tenant-scoped"
```

---

### Task 5: Lote D — templates + flows (Padrão A)

**Files:** Modify
- `app/api/templates/drafts/route.ts` (`templates` — 5 queries)
- `app/api/templates/drafts/[id]/route.ts` (`templates` — 4 queries)
- `app/api/flows/submissions/report.csv/route.ts` (`campaigns`, `flows`, `flow_submissions`)

**Interfaces:**
- Consumes: `getTenantContext` (Padrão A).

- [ ] **Step 1: Aplicar Padrão A**

`getTenantContext()` + `.eq('tenant_id', ctx.tenantId)` em cada `.from('templates' | 'campaigns' | 'flows' | 'flow_submissions')`. `report.csv` cruza 3 tabelas — escopar as 3. Onde há insert de template (drafts POST), incluir `tenant_id: ctx.tenantId`.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -E "templates/drafts|submissions/report"` → vazio.
Run: `npx vitest run` → sem regressão.

- [ ] **Step 3: Commit**

```bash
git add app/api/templates/drafts/route.ts "app/api/templates/drafts/[id]/route.ts" "app/api/flows/submissions/report.csv/route.ts"
git commit -m "fix(2C): lote D — templates drafts e report de submissões tenant-scoped"
```

---

### Task 6: Lote E — inbox (owner) + settings/performance (Padrão A)

**Files:** Modify
- `app/api/inbox/conversations/[id]/handoff/route.ts` (`inbox_conversations`, `inbox_messages`)
- `app/api/inbox/conversations/[id]/pause/route.ts` (`inbox_conversations`)
- `app/api/inbox/conversations/[id]/resume/route.ts` (`inbox_conversations`)
- `app/api/inbox/conversations/[id]/return-to-bot/route.ts` (`inbox_conversations`)
- `app/api/inbox/conversations/[id]/takeover/route.ts` (`inbox_conversations`)
- `app/api/inbox/suggest/route.ts` (`ai_agents`, `settings`)
- `app/api/settings/performance/route.ts` (`campaign_run_metrics`, `campaigns`)

**Interfaces:**
- Consumes: `getTenantContext` (Padrão A). Todas usam `createClient()` (sessão) → owner.

- [ ] **Step 1: Verificar se `/atendimento` chama estas rotas com token**

Antes de aplicar Padrão A puro, rodar: `grep -rn "conversations/.*\(handoff\|pause\|resume\|takeover\|return-to-bot\)" components/ app/atendimento --include="*.ts" --include="*.tsx"`. Se a tela de atendente (`/atendimento`) chamar estas rotas passando `?token=`, aplicar **Padrão A-com-fallback-B** (Task 1 é pré-requisito). Se só o dashboard do owner as chama, Padrão A puro. Documentar a decisão no relatório.

- [ ] **Step 2: Aplicar o padrão decidido**

`getTenantContext()` (+ fallback token se aplicável) + `.eq('tenant_id', tenantId)` em cada query. `inbox/suggest` lê `settings` (chave de IA) → `settingsDb.get(tenantId, ...)`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -E "inbox/|settings/performance"` → vazio.
Run: `npx vitest run` → sem regressão.

- [ ] **Step 4: Commit**

```bash
git add "app/api/inbox/conversations/[id]/" app/api/inbox/suggest/route.ts app/api/settings/performance/route.ts
git commit -m "fix(2C): lote E — ações de inbox e settings/performance tenant-scoped"
```

---

### Task 7: Lote F — atendimento por token (Padrão B)

**Files:** Modify `app/api/attendant/conversations/route.ts` (`inbox_conversations`)

**Interfaces:**
- Consumes: `resolveTenantByAttendantToken` (Task 1).

**Contexto:** hoje esta rota usa `getSupabaseAdmin()` e lista `inbox_conversations` de **todos os tenants** sem validar token nenhum — vazamento grave. O front `/atendimento` acessa com `?token=` (ver `app/atendimento/layout.tsx` que lê `searchParams.get('token')`).

- [ ] **Step 1: Aplicar Padrão B**

Adicionar no início do GET: extrair `token` de `searchParams`, `const tenantId = await resolveTenantByAttendantToken(token)`, retornar 401 se null. Adicionar `.eq('tenant_id', tenantId)` na query de `inbox_conversations`. Manter o `getSupabaseAdmin` (não há sessão para RLS), o isolamento vem do filtro explícito.

- [ ] **Step 2: Teste do gate**

```typescript
// app/api/attendant/conversations/route.test.ts
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
const resolveMock = vi.fn()
vi.mock('@/lib/attendant-auth', () => ({ resolveTenantByAttendantToken: (...a: any[]) => resolveMock(...a) }))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ order: () => ({ limit: () => ({ data: [], error: null }) }) }) }) }) }))
import { GET } from './route'
describe('attendant/conversations — gate de token', () => {
  it('401 sem token válido', async () => {
    resolveMock.mockResolvedValueOnce(null)
    const res = await GET(new NextRequest('http://localhost/api/attendant/conversations'))
    expect(res.status).toBe(401)
  })
})
```
Ajustar os mocks de `getSupabaseAdmin` à cadeia real de chamadas do arquivo (ler antes). Se a cadeia divergir, alinhar o mock — o foco do teste é só o gate 401.

- [ ] **Step 3: Verificar**

Run: `npx vitest run app/api/attendant/conversations/route.test.ts && npx tsc --noEmit && npx vitest run` → gate passa, tsc limpo, sem regressão.

- [ ] **Step 4: Commit**

```bash
git add app/api/attendant/conversations/route.ts app/api/attendant/conversations/route.test.ts
git commit -m "fix(2C): lote F — attendant/conversations resolve tenant por attendant_token (fecha vazamento)"
```

---

### Task 8: Lote G — admin/debug (Padrão C)

**Files:** Modify
- `app/api/system/route.ts` (`campaigns`, `contacts`, `campaign_contacts`, `settings`)
- `app/api/debug/ai-logs/route.ts` (`ai_agent_logs`, `inbox_conversations`, `ai_agents`, `settings`)
- `app/api/debug/campaigns/[id]/audit/route.ts` (`campaigns`, `campaign_contacts`)

**Interfaces:**
- Consumes: `getTenantContext` (Padrão C — `isPlatformAdmin`).

- [ ] **Step 1: Aplicar Padrão C**

No início de cada handler: `const ctx = await getTenantContext(); if (!ctx?.isPlatformAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })`. As queries podem permanecer cross-tenant (é o propósito de um diagnóstico de plataforma), mas o acesso passa a exigir superadmin. **Atenção `system/route.ts`**: ele já tem uma checagem de `token` própria (linha ~190) para algum modo — ler o arquivo e decidir se o gate de admin substitui ou complementa essa checagem; preferir substituir por `isPlatformAdmin` se o token era um admin-key legado, mas confirmar antes de remover.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -E "system/route|debug/"` → vazio.
Run: `npx vitest run` → sem regressão.

- [ ] **Step 3: Commit**

```bash
git add app/api/system/route.ts app/api/debug/ai-logs/route.ts "app/api/debug/campaigns/[id]/audit/route.ts"
git commit -m "fix(2C): lote G — system e debug exigem platform_admin"
```

---

### Task 9: Fechamento — varredura de confirmação, suíte, runbook

**Files:** Modify `docs/superpowers/runbooks/2026-07-09-cutover-fase2a-2b.md` (marcar o item "queries diretas sem filtro de tenant" como resolvido pela Fase 2C).

- [ ] **Step 1: Varredura de confirmação**

Run o mesmo levantamento que originou o plano, para confirmar que sobraram só as rotas fora de escopo:
```bash
DOMAIN="settings|ai_agents|ai_knowledge_files|ai_agent_logs|ai_embeddings|contacts|campaigns|inbox_conversations|inbox_messages|workflows|templates|flows"
for f in $(grep -rlE "\.from\((['\"])($DOMAIN)\1\)" app/api --include="*.ts" | grep -v test); do
  grep -q "getTenantContext\|resolveTenantBy\|resolveWebhookTenantId\|tenant_id\|isPlatformAdmin" "$f" || echo "SEM TENANT: $f"
done
```
Expected: só `health/route.ts` (Padrão D, benigno) e rotas de `installer`/`user-auth` (fora de escopo). Qualquer outra rota listada é um gap — voltar e corrigir.

- [ ] **Step 2: Suíte completa + build + advisors**

Run: `npx tsc --noEmit && npm run build && npx vitest run` → tsc limpo, build ok, sem regressão sobre 3448 passed.
Run: `mcp__supabase__get_advisors` (security) → sem findings novos (esta fase não altera schema, então não deve haver; confirmar).

- [ ] **Step 3: Atualizar o runbook**

No runbook `2026-07-09-cutover-fase2a-2b.md`, seção "Bloqueadores conhecidos", marcar o item "Queries diretas sem filtro de tenant fora dos objetos *Db" como **resolvido pela Fase 2C** (referenciar este plano), e mover para uma seção "Resolvido". Registrar que `health` foi auditado e é benigno por design.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/runbooks/2026-07-09-cutover-fase2a-2b.md
git commit -m "docs(2C): runbook — fecha o gap de queries diretas sem tenant (Fase 2C completa)"
```

---

## Notas de execução

- **Task 1 é pré-requisito das Tasks 6 (se houver fallback-B) e 7.** As demais (2, 3, 4, 5, 8) são independentes entre si — arquivos distintos, paralelizáveis.
- Ordem recomendada: 1 → (2, 3, 4, 5, 8 em paralelo) → 6 → 7 → 9.
- Cada lote é uma task com deliverable testável: `tsc` limpo + suíte verde para os arquivos do lote. O modo de falha de qualquer bug de resolução é 401/403 (falha fechada, segura), não vazamento.
- Esta fase **não altera schema** — nenhuma migração nova. Só código de aplicação.
