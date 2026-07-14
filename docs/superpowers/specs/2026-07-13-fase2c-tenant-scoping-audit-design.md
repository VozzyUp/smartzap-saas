# Fase 2C — Auditoria de Tenant-Scoping das Rotas Diretas — Design

**Contexto:** A Fase 2A escopou por tenant os 10 objetos `*Db` de `lib/supabase-db.ts` e os call-sites que o `tsc` apontava ao mudar suas assinaturas. Rotas que consultam o Supabase **direto** (`supabase.from(...)`, `getSupabaseAdmin().from(...)`) não geram erro de tipo, então escaparam — é a pendência registrada no runbook da 2A/2B ("queries diretas sem filtro de tenant fora dos objetos *Db"). Em produção, isso aflorou: `app/api/settings/onboarding/route.ts` lia `settings` com `.eq('key').single()` sem `tenant_id`; com a PK composta `(tenant_id, key)`, o `.single()` encontra múltiplas linhas, estoura erro, e o cadastro entra em loop na tela de boas-vindas.

**Goal:** Garantir que nenhuma rota de `app/api` consulte tabela de domínio via Supabase direto sem escopar por tenant — fechando tanto os crashes (`.single()` sobre PK composta) quanto os vazamentos cross-tenant (IDOR via `getSupabaseAdmin` que bypassa RLS).

**Já corrigido nesta sessão (fora do escopo deste plano):** `settings/onboarding`, `settings/ai-agents-toggle`, `ai/models` (commits `d898a06`).

**Fora de escopo:** `app/api/installer/*` e `lib/user-auth.ts` (fluxo MASTER_PASSWORD, pré-tenant, gate do wizard `/install`); rotas que só fazem ping de conectividade sem ler valor de tenant.

## Global Constraints

- Nenhuma rota de `app/api` pode ler/escrever tabela de domínio (`settings`, `ai_agents`, `ai_knowledge_files`, `ai_agent_logs`, `ai_embeddings`, `contacts`, `campaigns`, `inbox_conversations`, `inbox_messages`, `workflows`, `templates`, `flows`, etc.) sem um `tenant_id` resolvido.
- Preferir os helpers já tenant-scoped (`settingsDb`, os `*Db`) a query direta. Onde a query direta for inevitável, incluir `.eq('tenant_id', tenantId)` em selects/updates/deletes e `tenant_id` em inserts.
- Config de IA (`google_api_key`, `openai_api_key`, providers de embedding/LLM, toggles) é **por-tenant** (`settingsDb`), não de plataforma — consistente com `ai/models` já corrigido.
- Testes: Vitest. Baseline atual (HEAD `d898a06`): `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` = 3448 passed, 6 skipped. Cada lote roda a suíte completa antes de commitar, sem regressão.
- Rotas de teste que importam módulos com `import "server-only"` (ex.: qualquer coisa que puxe `lib/builder/workflow-conversations`) precisam mockar esse módulo — o pacote `server-only` lança fora do build do Next (ver `app/api/webhook/route.test.ts`).
- Branch: nova branch a partir de `main` (`saas/fase-2c-tenant-audit`), já que a 2A+2B já foi mergeada e está em produção.

## Padrões de resolução de tenant (por modelo de auth da rota)

### Padrão A — Sessão de owner
Rota acessada pelo dono do tenant logado via magic link. Resolve com:
```ts
import { getTenantContext } from '@/lib/tenant-context'
const ctx = await getTenantContext()
if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
// usar ctx.tenantId em settingsDb / *Db / .eq('tenant_id', ...)
```

### Padrão B — Token de atendente
Rota acessada por um atendente via `attendant_token` (na query string `?token=` ou header), não pelo owner. A tabela `attendant_tokens` tem `tenant_id`, `is_active`, `expires_at`. Resolve validando o token:
```ts
import { resolveTenantByAttendantToken } from '@/lib/attendant-auth' // NOVO helper
const tenantId = await resolveTenantByAttendantToken(token) // null se inválido/expirado/inativo
if (!tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```
Onde a rota serve **owner e atendente** (ex.: ações de inbox chamadas tanto pelo dashboard quanto pela tela `/atendimento`), tenta a sessão primeiro (`getTenantContext`) e cai para o token se não houver sessão.

### Padrão C — Platform admin
Rota de diagnóstico/administração da plataforma que legitimamente cruza tenants. Exige superadmin:
```ts
const ctx = await getTenantContext()
if (!ctx?.isPlatformAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
// queries podem ser cross-tenant (é o propósito), mas só platform_admin acessa
```

### Padrão D — Intocado
Rota que só faz ping de conectividade (`.select('key').limit(1)`), sem ler valor específico de tenant. Não muda.

## Componentes

### Novo: `lib/attendant-auth.ts`
- `resolveTenantByAttendantToken(token: string | null): Promise<string | null>` — busca `attendant_tokens` por `token` via `getSupabaseAdmin` (bypassa RLS, é o ponto de entrada sem sessão), valida `is_active = true` e `expires_at` (nulo = sem expiração, ou futuro), retorna `tenant_id` ou `null`. Efeito colateral opcional: atualizar `last_used_at`/`access_count` (fora do caminho crítico; pode ficar para depois — YAGNI aqui).
- `lib/attendant-auth.test.ts`.

### Rotas — Padrão A (sessão de owner)
`ai-agents/route.ts`, `ai-agents/[id]/route.ts`, `ai-agents/[id]/chat/route.ts`, `ai-agents/knowledge/route.ts`, `ai-agents/embedding-providers/route.ts`, `ai-agents/llm-providers/route.ts`, `ai/generate-utility-templates/route.ts`, `settings/ai/route.ts`, `settings/performance/route.ts`, `contacts/country-codes/route.ts`, `contacts/state-codes/route.ts`, `contacts/tag-counts/route.ts`, `contacts/segment-count/route.ts`, `dashboard/stats/route.ts`, `templates/drafts/route.ts`, `templates/drafts/[id]/route.ts`, `flows/submissions/report.csv/route.ts`, `inbox/suggest/route.ts`.

Cada uma: adicionar `getTenantContext()` + escopar toda query (direta ou via helper) por `ctx.tenantId`. As que fazem várias queries a tabelas diferentes (ex.: `ai-agents/[id]/chat` toca `ai_agents`, `ai_embeddings`, `inbox_conversations`) precisam de `.eq('tenant_id', ...)` em **cada** query, não só na de `settings`.

### Rotas — Padrão B (token de atendente)
`attendant/conversations/route.ts` (hoje lista `inbox_conversations` de todos os tenants via `getSupabaseAdmin` sem token — vazamento grave). As ações de inbox (`inbox/conversations/[id]/{handoff,pause,resume,return-to-bot,takeover}`) — verificar na implementação se são chamadas com sessão (dashboard do owner), com token (tela `/atendimento`), ou ambos; aplicar A, B, ou A-com-fallback-B conforme o caso real de cada uma.

### Rotas — Padrão C (platform admin)
`system/route.ts`, `debug/ai-logs/route.ts`, `debug/campaigns/[id]/audit/route.ts`.

### Rotas — Padrão D (intocado)
`health/route.ts` — sem mudança (documentado aqui para registrar que foi auditado e considerado benigno).

## Data Flow (exemplo — inbox servido a owner ou atendente)

```
Request → tem cookie de sessão Supabase?
  sim → getTenantContext() → ctx.tenantId
  não → tem ?token= (attendant)? → resolveTenantByAttendantToken(token) → tenantId
  nenhum → 401
→ todas as queries da rota escopadas pelo tenantId resolvido
```

## Error Handling
- Sem tenant resolvível (nem sessão nem token válido): 401 (padrão A/B) ou 403 (padrão C, quando há sessão mas não é admin).
- `.single()` sobre tabela com PK composta: sempre acompanhar de `.eq('tenant_id', ...)` para garantir no máximo uma linha; onde "não existe" é caso normal, usar `.maybeSingle()` em vez de `.single()` para não tratar ausência como erro.

## Testing
- `lib/attendant-auth.test.ts`: token válido resolve tenant; token inativo/expirado/inexistente retorna null.
- Cada rota corrigida: onde já há teste, atualizar mocks; onde não há, teste mínimo do gate (401/403 sem tenant; isolamento com tenant). Não criar suíte exaustiva para lógica de negócio já existente — só o gate de tenant.
- `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão sobre 3448 passed.

## Rollback
Reversão = reverter os commits da fase. Como cada rota passa a exigir tenant, um bug de resolução causaria 401 (falha fechada, segura), não vazamento — o modo de falha é seguro por construção.
