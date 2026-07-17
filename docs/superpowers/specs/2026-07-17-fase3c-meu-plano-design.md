# Fase 3C — Meu Plano (usuário final) — Design

**Contexto:** Terceira fatia da frente 3. A 3A entregou `plans` + `tenants.plan_id` + `lib/plan-limits` (getTenantPlan, contadores, gates `canAddX` → `{allowed, limit, current}`). A 3B entregou o painel `/admin` (super-admin) + `PATCH /api/admin/plans/[id]`. Hoje o **cliente** não tem nenhuma tela do próprio plano, e ao estourar um limite recebe o 403 cru `{ error:'plan_limit', dimension, limit, current }`.

**Goal:** Dar ao cliente (dono do tenant) visibilidade do próprio plano — card no dashboard + página `/settings/plano` com uso vs limite, status do trial e comparativo dos planos com preço — e traduzir o erro `plan_limit` numa mensagem amigável com caminho de upgrade. Upgrade abre o WhatsApp de suporte (sem gateway).

**Fora de escopo:** cobrança/gateway; downgrade/troca self-service (o admin troca o plano manualmente pelo `/admin`, como na 3B).

## Decisões (aprovadas no brainstorm)

- Localização: **card resumido no Dashboard** + **página completa `/settings/plano`**.
- Upgrade: comparativo dos 3 planos (limites + preço) + botão "Falar com o time" → WhatsApp `+55 11 97619-4739` (`https://wa.me/5511976194739?text=...`).
- Preço: **mensal**, guardado em `plans.price_cents` (integer, centavos, BRL), editável pelo `/admin` (reaproveita o PATCH). `NULL` = grátis (Trial) ou "sob consulta" onde não definido. Exibe "R$ X,XX/mês".
- Uso vs limite reaproveita `lib/plan-limits` (getTenantPlan + contadores). `NULL` no limite = ilimitado ("∞").
- Mensagem amigável ao estourar limite, com link para `/settings/plano`.

## Global Constraints

- Server-side resolve o tenant via `getTenantContext` (sessão) → 401 sem sessão. Nunca vaza plano/uso de outro tenant.
- Reusar `lib/plan-limits` para contagem — não duplicar lógica de limite.
- Não alterar o comportamento dos gates (3A) nem do admin (3B); só adicionar a coluna de preço ao PATCH existente.
- Migração versionada em `supabase/migrations/` E aplicada via MCP.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-3c-meu-plano` a partir de `main`.

## Componentes

### 1. Schema — preço
- **Migração `<ts>_plan_price.sql`:** `ALTER TABLE plans ADD COLUMN price_cents integer;` (nullable). Popular opcional: deixar `NULL` (sob consulta) até o dono definir pelo `/admin`.
- **`/api/admin/plans/[id]` PATCH:** adicionar `price_cents` à whitelist `FIELDS` (aceita inteiro ≥ 0 ou `null`). **`/admin/plans` UI:** um input de preço por plano (em reais, converte pra centavos ao salvar).

### 2. `lib/plan-usage.ts` — snapshot de uso do tenant
- `getPlanUsage(tenantId): Promise<PlanUsage>` — monta o retorno consumido pela rota/UI:
  - `plan`: `{ slug, name, price_cents }` do plano atual (via `getTenantPlan`).
  - `usage`: para cada dimensão `{ used, limit }` (limit `null` = ilimitado), reusando os contadores de `lib/plan-limits` (`countRows` de contacts/templates/campaigns-mês/whatsapp_numbers). Expor um helper de contagem reutilizável em `lib/plan-limits` se necessário (sem duplicar).
  - `trial`: `{ endsAt: string | null, daysLeft: number | null }` (de `tenants.trial_ends_at`; `daysLeft` = ceil((endsAt-now)/dia), `null` se sem trial).
- Fail-safe: erro de leitura → retorna estrutura vazia/segura, não lança.

### 3. Rotas
- **`GET /api/plan`** — `getTenantContext` → 401 sem tenant; retorna `getPlanUsage(ctx.tenantId)`.
- **`GET /api/plans/catalog`** — lista pública (para o comparativo) dos planos ativos: `{ slug, name, price_cents, max_* }`, ordenada por `sort_order`. Exige sessão (qualquer usuário logado), não expõe nada sensível.

### 4. UI
- **`app/(dashboard)/settings/plano/page.tsx`** (client, consome `/api/plan` e `/api/plans/catalog` via React Query):
  - Cabeçalho: plano atual + preço; se em trial, badge "Trial — N dias restantes".
  - **Uso vs limite**: uma linha por dimensão (contatos, templates, campanhas no mês, números) com rótulo `used/limit` e uma barra de progresso (∞ quando `limit=null`; barra em alerta quando `used/limit ≥ 90%`).
  - **Comparativo**: cards dos 3 planos com limites e preço ("R$ X,XX/mês" ou "Grátis"/"Sob consulta"), destacando o plano atual. Botão "Falar com o time" → `wa.me/5511976194739` com texto pré-preenchido ("Quero fazer upgrade do meu plano no SmartZap").
- **Card no Dashboard** (`components/features/dashboard/PlanUsageCard.tsx`, incluído no dashboard): plano atual + a dimensão mais próxima do limite (ou "Trial — N dias") + link "Ver meu plano" → `/settings/plano`. Consome `/api/plan`.
- **Menu:** entrada "Meu Plano" em Configurações (ou item no submenu de settings) apontando para `/settings/plano`.

### 5. Mensagem amigável ao estourar limite
- **`lib/plan-limit-message.ts`** — mapa `dimension → { label, actionText }` e `formatPlanLimit(body): string` que produz "Seu plano permite até {limit} {label}. Faça upgrade para criar mais." a partir do 403 `{ error:'plan_limit', dimension, limit, current }`.
- Nos handlers client que chamam as rotas com gate (criar contato/import, criar template, criar campanha, conectar número): ao receber 403 com `error==='plan_limit'`, exibir `toast.error(formatPlanLimit(body))` com ação/atalho para `/settings/plano` (usar o `toast` do sonner já no repo). Centralizar a checagem num helper para não repetir.

## Data Flow
```
/settings/plano (client) → GET /api/plan → getTenantContext → getPlanUsage(tenantId)
                        → GET /api/plans/catalog → lista de planos + preço
Ação bloqueada → 403 {plan_limit,...} → formatPlanLimit → toast + link /settings/plano
Upgrade → wa.me/5511976194739 (texto pré-preenchido)
```

## Error Handling
- `/api/plan` sem sessão → 401. Erro de contagem → uso parcial/seguro (nunca 500 que quebre a página).
- Preço inválido no PATCH admin → 400 (inteiro ≥ 0 ou null).
- Comparativo sem preço definido → "Sob consulta" (não quebra).

## Testing
- `lib/plan-usage.test.ts`: `getPlanUsage` — uso/limite por dimensão, limite `null`→ilimitado, trial daysLeft (futuro/nulo/passado), fail-safe.
- `lib/plan-limit-message.test.ts`: `formatPlanLimit` — cada dimensão gera o texto certo; body malformado → fallback genérico.
- Rota `/api/plan`: 401 sem sessão; 200 com uso. Rota `/api/plans/catalog`: 401 sem sessão; lista com sessão.
- Admin PATCH: `price_cents` aceito (inteiro/null), inválido → 400.
- Páginas/cards não exigem teste automatizado (padrão do repo).
- Sem regressão; `tsc`/`build` limpos.

## Rollback
Reverter os commits. `plans.price_cents` pode permanecer (nullable, inerte). Nenhuma alteração destrutiva.
