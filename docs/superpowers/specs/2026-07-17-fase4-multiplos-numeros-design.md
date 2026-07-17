# Fase 4 — Múltiplos números WhatsApp por tenant — Design

**Contexto:** Última frente do roadmap SaaS. Hoje cada tenant tem **1 número**: as credenciais (`phoneNumberId`, `businessAccountId`, `accessToken`) vivem em `settings` como um único conjunto, lidas por `getWhatsAppCredentials(tenantId)` — que tem **47 call-sites** (campanhas, templates, flows, inbox, health-check). A tabela `whatsapp_phone_numbers(phone_number_id, tenant_id)` existe desde a Fase 2B, mas serve só para o webhook resolver o tenant (`resolveTenantByPhoneNumberId`). O gate `canAddWhatsAppNumber(tenantId)` já existe (Fase 3A) e lê `plans.max_whatsapp_numbers`.

**Goal:** Permitir vários números por tenant, limitados pelo plano. Modelo **"número ativo"**: o tenant cadastra N números, exatamente 1 fica ativo; envios novos (campanhas, primeira mensagem) usam o ativo; respostas do inbox usam **o número da própria conversa** (exigência da API do WhatsApp). Adicionar número além do limite do plano **bloqueia com aviso de upgrade** (padrão 3A/3C).

**Fora de escopo:** escolha de número por-campanha/por-ação (só "ativo por vez"); cobrança/gateway; troca de número em conversas existentes.

## Decisões (aprovadas no brainstorm)

- **Modelo:** 1 número ativo por vez. `getWhatsAppCredentials(tenantId)` retorna o número ativo → os 47 call-sites ficam inalterados.
- **Fonte de verdade:** enriquecer `whatsapp_phone_numbers` para guardar as credenciais por número + `is_active` + `display_label`. Migração **não-destrutiva**: `getWhatsAppCredentials` lê a linha ativa; **fallback para `settings`** se não houver linha ativa (legado, reversível).
- **Inbox:** resposta sai **do número da conversa** (nova coluna `whatsapp_number_id` em `inbox_conversations`, preenchida no recebimento). O "ativo" NÃO rege respostas de conversas existentes.
- **Limite do plano:** adicionar além do limite → `canAddWhatsAppNumber` bloqueia, toast "Seu plano permite até N números — faça upgrade" com link para `/settings/plano`.
- **Segurança:** `access_token` nunca volta ao browser; RLS restritivo (token só via service role).

## Global Constraints

- `getWhatsAppCredentials(tenantId)` mantém a MESMA assinatura e o MESMO tipo de retorno (`{ phoneNumberId, businessAccountId, accessToken } | null`). Nenhum dos 47 call-sites muda.
- Migração **não-destrutiva e reversível**: com a tabela vazia/sem linha ativa, o comportamento é idêntico ao de hoje (lê `settings`). `settings` não é apagado.
- Exatamente **1 número ativo por tenant** (garantido por índice único parcial `WHERE is_active`).
- `access_token` e `business_account_id` nunca são serializados para o client. As rotas que listam números retornam só `{ id, phone_number_id, display_label, is_active, phone_display? }`.
- Todo acesso resolve o tenant via `getTenantContext` (sessão) → 401/403 sem tenant. Adicionar/ativar/remover número respeita o tenant do contexto (nunca mexe em número de outro tenant).
- Gate reusa `canAddWhatsAppNumber` (3A) — não duplicar lógica de limite.
- Migração versionada em `supabase/migrations/` E aplicada via MCP.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-4-multiplos-numeros` a partir de `main`.

## Componentes

### 1. Schema — credenciais por número + conversa→número
Tabela existente (Fase 2B): **PK `phone_number_id text`** (não há `id uuid`), `tenant_id uuid`, `business_account_id text` (já existe), `flows_webhook_token`, timestamps. RLS "own tenant" + `GRANT ... to authenticated`. O identificador em rotas/FK é o próprio `phone_number_id`.
- **Migração `<ts>_multi_numbers.sql`:**
  - `ALTER TABLE whatsapp_phone_numbers ADD COLUMN access_token text, ADD COLUMN display_label text, ADD COLUMN is_active boolean NOT NULL DEFAULT false;` (`business_account_id` já existe).
  - Índice único parcial: `CREATE UNIQUE INDEX uq_wa_active_per_tenant ON whatsapp_phone_numbers (tenant_id) WHERE is_active;`
  - `ALTER TABLE inbox_conversations ADD COLUMN whatsapp_number_id text REFERENCES whatsapp_phone_numbers(phone_number_id) ON DELETE SET NULL;` (nullable; conversas antigas ficam null → fallback ao ativo).
  - **Segurança por coluna:** `REVOKE SELECT ON whatsapp_phone_numbers FROM authenticated;` seguido de `GRANT SELECT (phone_number_id, tenant_id, business_account_id, display_label, is_active, flows_webhook_token, created_at, updated_at) ON whatsapp_phone_numbers TO authenticated;` — o `access_token` fica ilegível via PostgREST mesmo para o próprio tenant; só o service role (rotas/servidor) o lê. `INSERT/UPDATE/DELETE` continuam concedidos.
  - **Backfill:** para cada tenant com credenciais em `settings`, garantir uma linha em `whatsapp_phone_numbers` com `access_token` (e `business_account_id` se faltar) de `settings` e `is_active=true` (a linha do `phoneNumberId` atual). SQL idempotente na migração.

### 2. `lib/whatsapp-phone-numbers.ts` — camada de números
Identificador em todas estas funções é o `phoneNumberId` (a PK text), não um uuid.
- `getActiveWhatsAppNumber(tenantId): Promise<WhatsAppNumberRow | null>` — a linha ativa do tenant.
- `getWhatsAppNumberByPhoneId(tenantId, phoneNumberId): Promise<WhatsAppNumberRow | null>` — para o reply do inbox (escopado ao tenant).
- `listWhatsAppNumbers(tenantId): Promise<WhatsAppNumberPublic[]>` — sem token (usa o SELECT por-coluna; nunca projeta `access_token`).
- `addWhatsAppNumber(tenantId, { phoneNumberId, businessAccountId, accessToken, displayLabel }): Promise<WhatsAppNumberRow>` — upsert por `phone_number_id`; se for o 1º do tenant, já entra `is_active=true`.
- `setActiveWhatsAppNumber(tenantId, phoneNumberId): Promise<void>` — transação: zera `is_active` do tenant e liga o escolhido.
- `removeWhatsAppNumber(tenantId, phoneNumberId): Promise<void>` — remove; se era o ativo e sobra outro, promove outro a ativo (senão deixa sem ativo → fallback settings). Conversas dependentes ficam com `whatsapp_number_id` null via `ON DELETE SET NULL`.
- Mantém as funções existentes (`resolveTenantByPhoneNumberId`, tokens de flows).

### 3. `lib/whatsapp-credentials.ts` — leitura com fallback
- `getWhatsAppCredentials(tenantId)` (assinatura inalterada): tenta `getActiveWhatsAppNumber(tenantId)`; se existir, retorna suas credenciais; **senão**, cai no comportamento atual (lê `settings`). Fail-safe.
- **Novo** `getWhatsAppCredentialsForNumber(tenantId, whatsappNumberId): Promise<WhatsAppCredentials | null>` — credenciais de um número específico (para o reply do inbox); se `whatsappNumberId` for null, delega ao ativo/legado.

### 4. Recebimento e resposta do inbox
- **Webhook (recebimento):** ao criar/obter a conversa, resolver a linha de `whatsapp_phone_numbers` pelo `phone_number_id` que recebeu e gravar `whatsapp_number_id` na conversa (via `getOrCreateConversation`/`createConversation` — adicionar o parâmetro).
- **Reply (`lib/inbox/inbox-service.ts`):** em vez de `getWhatsAppCredentials(tenantId)`, usar `getWhatsAppCredentialsForNumber(tenantId, conversation.whatsapp_number_id)` (o `whatsapp_number_id` é o `phone_number_id` da conversa). Se null (conversa antiga), usa o ativo/legado.

### 5. Rotas
- **`GET /api/whatsapp-numbers`** — `getTenantContext` → 401; `listWhatsAppNumbers` (sem token).
- **`POST /api/whatsapp-numbers`** — body `{ phoneNumberId, businessAccountId, accessToken, displayLabel }`. Antes de inserir: `canAddWhatsAppNumber(tenantId)` → se `!allowed`, 403 `{ error:'plan_limit', dimension:'whatsapp_numbers', limit, current }` (padrão dos gates). Senão `addWhatsAppNumber`.
- **`POST /api/whatsapp-numbers/[id]/activate`** — `setActiveWhatsAppNumber` (`[id]` = `phone_number_id`).
- **`DELETE /api/whatsapp-numbers/[id]`** — `removeWhatsAppNumber` (`[id]` = `phone_number_id`).
- Todas resolvem/validam o tenant via contexto e escopam a operação por `tenant_id` (nunca mexem em número de outro tenant, mesmo com `phone_number_id` arbitrário no path).

### 6. UI — Configurações › Números
- **`app/(dashboard)/settings/numeros/page.tsx`** (client, React Query sobre as rotas):
  - Lista de números: apelido, telefone (se disponível), badge "Ativo", ações "Definir como ativo" e "Remover".
  - Botão **"Adicionar número"** → formulário (phone_number_id, business_account_id, access_token, apelido). Ao 403 `plan_limit`, `toast.error(formatPlanLimit(body))` com link "Ver meu plano" → `/settings/plano` (reusa `lib/plan-limit-message` da 3C).
  - Nunca exibe o token de números já cadastrados.
- **Menu:** entrada "Números de WhatsApp" em Configurações.

## Data Flow
```
Envio novo (campanha/1ª msg) → getWhatsAppCredentials(tenant) → número ATIVO (ou settings legado)
Recebimento (webhook) → resolve number por phone_number_id → grava whatsapp_number_id na conversa
Reply inbox → getWhatsAppCredentialsForNumber(tenant, conversa.whatsapp_number_id) → número da CONVERSA
Adicionar número → canAddWhatsAppNumber → allowed? insere : 403 plan_limit → toast upgrade
Ativar → setActiveWhatsAppNumber (1 ativo por tenant, índice único garante)
```

## Error Handling
- Rotas sem sessão → 401; número de outro tenant → 404/403 (nunca vaza).
- Adicionar além do limite → 403 `plan_limit` (não 500).
- `getWhatsAppCredentials` com erro de leitura da tabela → fallback para `settings` (fail-safe, nunca derruba envio).
- Índice único de ativo: `setActive` faz zera-todos + liga-um em transação; conflito impossível.

## Testing
- `lib/whatsapp-phone-numbers.test.ts`: add (1º vira ativo), setActive (só 1 ativo), remove (promove outro a ativo ou deixa sem ativo), list (sem token), getByPhoneId escopado ao tenant.
- `lib/whatsapp-credentials.test.ts`: `getWhatsAppCredentials` → ativo quando existe; **fallback settings** quando não há linha ativa; `getWhatsAppCredentialsForNumber` → número certo; null → ativo/legado.
- Rotas: 401 sem sessão; POST bloqueado por `plan_limit` (mock gate) → 403; activate/delete escopados ao tenant.
- Reply do inbox usa o número da conversa (mock `getWhatsAppCredentialsForNumber`).
- Páginas/UI sem teste automatizado (padrão do repo).
- Sem regressão; `tsc`/`build` limpos. Os 47 call-sites de `getWhatsAppCredentials` continuam compilando (assinatura inalterada).

## Rollback
Reverter os commits. As colunas novas em `whatsapp_phone_numbers`/`inbox_conversations` podem permanecer (nullable/default false, inertes). Com nenhuma linha ativa, `getWhatsAppCredentials` volta a ler `settings` — comportamento idêntico ao pré-Fase 4. `settings` nunca é apagado. Nenhuma alteração destrutiva.
```
