# Fase 2B — Resolução de Tenant em Webhooks + Fix do Workflow Builder — Design

**Contexto:** A Fase 2A fechou RLS multi-tenant nas 38 tabelas de domínio e a sessão de usuário via Supabase Auth. Duas classes de rota ficaram bloqueadas de propósito (`resolveWebhookTenantId()`, que sempre lança) por não terem sessão de usuário nem forma indexada de descobrir a qual tenant pertencem: o webhook do Meta WhatsApp e o webhook do Google Calendar. Além disso, o workflow builder visual (`lib/builder/workflow-db.ts`) ficou quebrado — insere em `workflows`/`workflow_versions` sem `tenant_id`, coluna `NOT NULL` desde a Fase 2A.

**Goal:** Destravar as duas rotas de webhook resolvendo tenant a partir de um identificador já presente no payload (sem sessão), e corrigir o workflow builder para operar de forma tenant-scoped, incluindo um bug adicional achado no brainstorming (`getCompanyId` lê `settings` sem filtro de tenant, quebrado desde que `settings` ganhou PK composta `(tenant_id, key)`).

**Fora de escopo (adjudicado no brainstorming):** queries diretas sem filtro de tenant em `app/api/settings/all`, `app/api/settings/booking`, `app/api/campaigns/[id]` e afins (achados da Fase 2A, não relacionados a webhook/workflow builder) — cleanup à parte, fora desta fase.

## Global Constraints

- Toda tabela nova segue o padrão RLS da Fase 2A: `enable row level security`, policy `to authenticated using (tenant_id = (select current_tenant_id()) or (select is_platform_admin((select auth.uid()))))`, e para funções `SECURITY DEFINER` (se houver): `revoke execute ... from public, anon;`.
- Iterar SQL com `mcp__supabase__execute_sql`; `get_advisors` (security + performance) após aplicar; salvar migração final em `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`.
- Nenhuma tabela nova de mapeamento pode permitir dois tenants reivindicando o mesmo identificador externo simultaneamente — `phone_number_id`/`channel_token` são `primary key`, então um upsert por um novo tenant naturalmente rouba a posse (comportamento desejado: reconfiguração transfere o dono).
- Testes: Vitest, `npm run test`/`npm run build`/`npm run lint`. Baseline pós-2A: 3430 passed, 4 skipped, `tsc --noEmit` limpo.
- Branch: continua em `saas/fase-2-multitenancy` — 2B fecha blockers conhecidos da 2A na mesma branch ainda não mergeada, mesmo ciclo de cutover.

## Componentes

### 1. `whatsapp_phone_numbers` (tabela nova)

```
phone_number_id text primary key
tenant_id uuid not null references tenants(id) on delete cascade
business_account_id text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

RLS: `to authenticated` só enxerga/edita a própria linha (`tenant_id = current_tenant_id()`); `service_role` bypassa (usado pelo webhook, que não tem sessão de usuário).

**Escrita (write-through):** todo ponto do produto que salva `phoneNumberId`/`businessAccountId` em `settings` (hoje: rota de configuração WhatsApp em Settings, e o fluxo de Embedded Signup se existir) passa a também fazer `upsert` nesta tabela, chaveado por `phone_number_id`. Se o `phone_number_id` já pertence a outro tenant, o upsert transfere a posse (reconfiguração intencional > número duplicado acidental).

**Leitura:** só o webhook usa esta tabela para resolver tenant. Nenhuma outra rota lê `whatsapp_phone_numbers` para servir dados — a fonte de verdade de credenciais continua sendo `settings` per-tenant.

### 2. `google_calendar_channels` (tabela nova)

```
channel_token text primary key
tenant_id uuid not null references tenants(id) on delete cascade
channel_id text
resource_id text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Mesmo padrão de RLS e write-through, acoplado a `saveCalendarChannel()` em `lib/google-calendar.ts`.

### 3. `app/api/webhook/route.ts` (Meta) — resolução de tenant

- **GET (handshake):** inalterado — não depende de tenant.
- **POST:** primeiro passo do handler extrai `phone_number_id` de `entry[].changes[].value.metadata.phone_number_id` do payload. Faz `select tenant_id from whatsapp_phone_numbers where phone_number_id = $1` (client `service_role`).
  - **Não encontrado:** log estruturado (`console.warn` com `phone_number_id`, sem dado sensível de mensagem) e retorna `200 OK` sem processar. Meta trata 200 como "recebido" — não reenviar é o comportamento correto para um número que genuinamente não pertence a nenhum tenant ativo (não é erro transitório).
  - **Encontrado:** segue o fluxo existente do arquivo, com `tenantId` threading para as chamadas que hoje usam `resolveWebhookTenantId()` (ex.: `ensureWorkflowRecord` na linha ~1023, conforme grep feito no brainstorming).
- Múltiplos `entry`/`changes` no mesmo payload (Meta pode batchar) teoricamente poderiam ter `phone_number_id` diferentes — não é o caso comum, mas o handler deve resolver tenant **por entry**, não uma vez para o payload inteiro, para não processar erroneamente um entry de outro tenant caso isso aconteça.

### 4. `app/api/integrations/google-calendar/webhook/route.ts` — resolução de tenant

- O `channel_token` já vem no header `x-goog-channel-token` antes mesmo de saber o tenant (diferente do fluxo atual, que assumia `tenantId` para depois validar o token). Novo fluxo: `select tenant_id, channel_id, resource_id from google_calendar_channels where channel_token = $1`. Não encontrado → `401` (mesmo comportamento de token inválido que já existia, só muda a fonte da comparação). Encontrado → segue com `tenantId` resolvido, chama `getCalendarChannel(tenantId)`/`markCalendarNotification(tenantId, ...)` como hoje.

### 5. `lib/builder/workflow-db.ts` — tenant-scoping

- `ensureWorkflowRecord(supabase, tenantId, workflowId, ownerCompanyId?)`, `createWorkflowRecord(supabase, tenantId, input, ownerCompanyId?)`, `updateWorkflowRecord(supabase, tenantId, workflowId, patch)`, `getCompanyId(supabase, tenantId)`: `tenantId` sempre logo após `supabase` (2º parâmetro, posição fixa e consistente nas 4 funções — segue a convenção já usada nos objetos `*Db` da Fase 2A, onde o identificador de tenant é o primeiro argumento "de negócio" depois do client). Inserts em `workflows`/`workflow_versions` incluem `tenant_id: tenantId`. Reads (`fetchWorkflowRecord`) passam a filtrar `.eq('tenant_id', tenantId)`.
- `getCompanyId`: adiciona `.eq('tenant_id', tenantId)` ao select — sem isso, `.maybeSingle()` quebra com "multiple rows" assim que existir mais de um tenant com a chave `company_id` em `settings`.
- **Call-sites com sessão** (`workflows/create`, `workflows/current`, `workflows/[workflowId]/{route,duplicate,download,publish,run,webhook}`, `executions/[executionId]/logs` — 8 rotas): resolvem via `getTenantContext()`, mesmo padrão já usado em todo o resto do produto pós-2A.
- **Call-sites sem sessão** (handlers `serve()` do Upstash Workflow — `workflow/[workflowId]/execute`, `workflow/[workflowId]/resume`): recebem `tenantId` dentro do `requestPayload` de quem os dispara. Os 3 disparadores identificados no brainstorming:
  - `app/api/webhook/route.ts` (linhas ~996 e ~1032): já vai ter `tenantId` resolvido pelo item 3 acima — passa direto.
  - `lib/builder/api-client.ts:491`: chamado de rota com sessão do builder (UI "executar agora") — resolve `tenantId` via `getTenantContext()` antes de montar o payload.
  - `lib/builder/workflow-schedule.ts:43`: dispara execução agendada (QStash) de um workflow **já existente** — busca `tenant_id` direto da linha em `workflows` (mesmo padrão do fix de `campaign/workflow` na Fase 2A: deriva do recurso, não inventa sessão).
  - Dentro do handler `serve()`, se `tenantId` não vier no payload (chamada antiga/externa), cai para o mesmo fallback do `campaign/workflow`: busca `tenant_id` da linha existente em `workflows` por `workflowId`; se a linha não existir E não houver `tenantId` no payload, lança erro claro (não há como criar um registro sem dono).

## Data Flow (webhook Meta, caminho feliz)

```
Meta POST /api/webhook
  → extrai phone_number_id do entry
  → SELECT tenant_id FROM whatsapp_phone_numbers WHERE phone_number_id = X (service_role)
  → tenantId resolvido
  → segue processamento existente (process_inbound_message RPC, ensureWorkflowRecord, etc.)
       todas as chamadas que hoje recebem tenantId via resolveWebhookTenantId()
       passam a receber o tenantId resolvido aqui
```

## Error Handling

- `phone_number_id`/`channel_token` sem match: não é exceção — é um caminho de retorno normal (200 para Meta, 401 para Calendar), documentado acima.
- Falha de rede/DB no lookup da tabela de mapeamento: propaga erro (500), não finge sucesso — evita processar payload sem saber o tenant.
- `ensureWorkflowRecord` chamado sem `tenantId` resolvível (nem no payload, nem na linha existente): lança erro explícito, mesmo padrão fail-loud usado em toda a 2A.

## Testing

- Migração das 2 tabelas novas: `get_advisors` limpo, smoke test via `execute_sql` (insert tenant A, upsert phone_number_id, tenant B não enxerga via RLS `authenticated`, `service_role` enxerga).
- `whatsapp-credentials.test.ts` (se existir) / novo teste: salvar credenciais faz upsert em `whatsapp_phone_numbers`.
- Teste do webhook: payload com `phone_number_id` mapeado → processa; não mapeado → 200 sem processar (mock do lookup).
- `lib/builder/workflow-db.test.ts` (novo ou estendido): `ensureWorkflowRecord`/`createWorkflowRecord` exigem `tenantId`, inserts incluem `tenant_id`; `getCompanyId` filtra por tenant.
- `npx tsc --noEmit` limpo, `npx vitest run` sem regressão sobre o baseline (3430 passed, 4 skipped + novos testes desta fase).

## Rollback

Migração reversível: `drop table whatsapp_phone_numbers, google_calendar_channels` (sem dependências de outras tabelas apontando para elas). Reversão de código = reverter os commits desta fase; `resolveWebhookTenantId()` volta a ser o guard ativo (comportamento seguro por padrão — bloqueia em vez de vazar).
