# Fase 6 — Kanban de clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Quadros Kanban (múltiplos funis) onde o card é o contato; fases editáveis (nome/cor/ordem); drag & drop; tag espelhada `funil/<board>: <fase>` para campanhas; chip de fase no inbox.

**Architecture:** 3 tabelas tenant-scoped (`kanban_boards/stages/cards`, unique board+contact), camada `lib/kanban.ts` (service role) com espelho de tag em `contacts.tags`, rotas `/api/kanban/*`, página `/kanban` com `@dnd-kit`, chip no inbox.

**Tech Stack:** Next.js 16, Supabase (RLS padrão 2A), React Query, @dnd-kit/core + @dnd-kit/sortable (novo), Vitest.

## Global Constraints

- Tenant-scoped em tudo: `tenant_id NOT NULL` + RLS own-tenant (padrão 2A: `current_tenant_id()`/`is_platform_admin`, `TO authenticated`, `(select auth.uid())`) + GRANT; rotas com `getTenantContext` → 401; board/stage/card de outro tenant → 404.
- Tag espelhada: prefixo `funil/`; a troca remove SÓ a tag antiga do mesmo board; best-effort (falha de tag não desfaz movimento).
- `deleteStage` com cards → 409 (bloquear, não mover silenciosamente). `addCard` duplicado (unique board+contact) → 409 amigável.
- Migração versionada + aplicada via MCP. Baseline: tsc limpo, build ok, suíte sem regressão.
- Branch: `saas/fase-6-kanban`. Commits com `git commit -m "..." -- <paths>`.

## File Structure
- `supabase/migrations/20260721000001_kanban.sql` (T1)
- `lib/kanban.ts` + `lib/kanban.test.ts` (T2)
- `app/api/kanban/**` (T3)
- `app/(dashboard)/kanban/page.tsx` + componentes + `DashboardShell.tsx` + package.json (@dnd-kit) (T4)
- `components/features/inbox/ConversationHeader.tsx` (ou painel) — chip de fase (T5)
- `docs/superpowers/runbooks/2026-07-18-fase6-kanban.md` (T6)

---

### Task 1: Schema (controller aplica via MCP)

**Files:** Create `supabase/migrations/20260721000001_kanban.sql`

- [ ] **Step 1:** Migração com o SQL da spec (3 tabelas + índices `(tenant_id)`, `(board_id)`, `(stage_id)` + RLS own-tenant no padrão 2A + GRANT select/insert/update/delete to authenticated). Colunas exatamente como na spec (incl. `wa_label_id text` nullable em stages, `unique (board_id, contact_id)` em cards).
- [ ] **Step 2:** Aplicar via MCP (`apply_migration` name `kanban`), verificar com `execute_sql` (3 tabelas, unique constraint, policies).
- [ ] **Step 3:** Commit: `git commit -m "feat(fase6): schema kanban (boards/stages/cards + RLS)" -- supabase/migrations/20260721000001_kanban.sql`

---

### Task 2: `lib/kanban.ts` — camada de dados + tag espelhada

**Files:** Create `lib/kanban.ts`, `lib/kanban.test.ts`

**Interfaces (Produces):**
- Tipos: `KanbanBoard { id, tenant_id, name, position }`, `KanbanStage { id, board_id, name, color, position }`, `KanbanCard { id, board_id, stage_id, contact_id, position, moved_at }`, `KanbanBoardData { board, stages: (KanbanStage & { cards: (KanbanCard & { contact: { id, name, phone } })[] })[] }`, `ContactStageInfo { boardId, boardName, stageId, stageName, stageColor, cardId }`.
- `listBoards(tenantId): Promise<KanbanBoard[]>`
- `createBoard(tenantId, name): Promise<KanbanBoard>` — cria 3 fases padrão: Novo `#3b82f6`, Em andamento `#f59e0b`, Concluído `#22c55e` (positions 0/1/2).
- `renameBoard(tenantId, boardId, name)`, `deleteBoard(tenantId, boardId)` (remove tags `funil/<board>: *` dos contatos dos cards antes de deletar).
- `listStages(tenantId, boardId)`, `createStage(tenantId, boardId, { name, color })` (position = max+1), `updateStage(tenantId, stageId, { name?, color? })` (renome atualiza tags dos contatos da fase), `reorderStages(tenantId, boardId, orderedIds: string[])`, `deleteStage(tenantId, stageId)` → lança `KanbanError('stage_has_cards')` se houver cards.
- `getBoardData(tenantId, boardId): Promise<KanbanBoardData | null>` — 1 query de stages + 1 de cards com join de contato (name, phone), ordenadas por position.
- `addCardToBoard(tenantId, boardId, contactId, stageId?)` — default 1ª fase; unique violation → `KanbanError('card_exists')`; chama `syncStageTag`.
- `moveCard(tenantId, cardId, { stageId, position })` — valida stage do MESMO board (senão `KanbanError('invalid_stage')`); atualiza `moved_at`; `syncStageTag` (fase antiga→nova).
- `removeCard(tenantId, cardId)` — remove card + tag.
- `getContactStages(tenantId, contactId): Promise<ContactStageInfo[]>`.
- `syncStageTag(tenantId, contactId, boardName, oldStageName, newStageName)` — lê `contacts.tags` (jsonb array de strings), remove `funil/${boardName}: ${oldStageName}` (se oldStageName), adiciona `funil/${boardName}: ${newStageName}` (se newStageName), update escopado por tenant. Best-effort: try/catch com console.warn, nunca lança.
- Todas via `getSupabaseAdmin()`, TODAS as queries com `.eq('tenant_id', tenantId)`.

- [ ] **Step 1:** Testes falhando (mock getSupabaseAdmin no estilo dos testes de `lib/whatsapp-phone-numbers.test.ts`): createBoard cria board+3 fases; addCard → 1ª fase + tag adicionada; addCard duplicado → KanbanError('card_exists'); moveCard → update + tag antiga removida/nova adicionada; moveCard stage de outro board → invalid_stage; removeCard → delete + tag removida; deleteStage com cards → stage_has_cards; getContactStages escopado por tenant; syncStageTag não lança em erro de DB (best-effort).
- [ ] **Step 2:** `npx vitest run lib/kanban.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx vitest run lib/kanban.test.ts` → PASS + `npx tsc --noEmit`.
- [ ] **Step 5:** Commit: `git commit -m "feat(fase6): lib/kanban (boards/stages/cards + tag espelhada funil/)" -- lib/kanban.ts lib/kanban.test.ts`

---

### Task 3: Rotas `/api/kanban/*`

**Files:** Create sob `app/api/kanban/`: `boards/route.ts` (GET/POST), `boards/[id]/route.ts` (PATCH/DELETE), `boards/[id]/data/route.ts` (GET), `boards/[id]/stages/route.ts` (POST), `boards/[id]/stages/reorder/route.ts` (POST), `stages/[id]/route.ts` (PATCH/DELETE), `boards/[id]/cards/route.ts` (POST), `cards/[id]/route.ts` (PATCH/DELETE), `contact/[contactId]/stages/route.ts` (GET). Test: `app/api/kanban/routes.test.ts` (um arquivo cobrindo os principais).

**Interfaces:** Consomem `lib/kanban` (T2) + `getTenantContext`. Next 16: `params` é Promise → `await params`.

- [ ] **Step 1:** Testes falhando: 401 sem sessão (boards GET); POST boards cria; PATCH cards move (mock moveCard); addCard duplicado → 409 `{error:'card_exists'}`; deleteStage com cards → 409; GET contact stages → lista. Mock de `lib/kanban`.
- [ ] **Step 2:** FAIL → implementar: mapear `KanbanError` para status (card_exists/stage_has_cards → 409; invalid_stage → 400; não achado → 404). Corpo JSON `{ error }`.
- [ ] **Step 3:** PASS + tsc.
- [ ] **Step 4:** Commit: `git commit -m "feat(fase6): rotas /api/kanban (boards/stages/cards/contact-stages)" -- app/api/kanban/`

---

### Task 4: UI `/kanban` + menu + @dnd-kit

**Files:** Create `app/(dashboard)/kanban/page.tsx` (+ subcomponentes em `components/features/kanban/` se ficar grande); Modify `app/(dashboard)/DashboardShell.tsx` (item "Funil", ícone lucide `Columns3` ou `KanbanSquare`); Modify `package.json` (+`@dnd-kit/core` `@dnd-kit/sortable` `@dnd-kit/utilities`).

- [ ] **Step 1:** `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.
- [ ] **Step 2:** Página client (React Query): seletor de funil (dropdown; "+ Novo funil" com prompt de nome); colunas por fase (`GET boards/[id]/data`): header com bolinha da cor + nome + contagem + menu (renomear/cor/excluir); cards (nome, telefone, tempo desde moved_at); "+ fase" no fim; botão "Adicionar cliente" (dialog com busca em `/api/contacts` existente → POST cards).
- [ ] **Step 3:** DnD: `DndContext` + `SortableContext` por coluna; onDragEnd → `PATCH /api/kanban/cards/[id]` com optimistic update (React Query setQueryData) e rollback/invalidate em erro. Cores: paleta fixa de ~8 cores (estilo etiquetas WhatsApp) num popover simples.
- [ ] **Step 4:** Menu "Funil" no DashboardShell (mesmo padrão de "Números de WhatsApp"/3C).
- [ ] **Step 5:** `npx tsc --noEmit` + `npm run build` → ok. Commit: `git commit -m "feat(fase6): pagina /kanban com drag&drop + menu Funil" -- "app/(dashboard)/kanban/" components/features/kanban/ "app/(dashboard)/DashboardShell.tsx" package.json package-lock.json`

---

### Task 5: Inbox — chip de fase

**Files:** Modify `components/features/inbox/ConversationHeader.tsx` (ler antes; se houver painel de detalhes do contato, avaliar o melhor ponto — documentar escolha).

- [ ] **Step 1:** Query `['contact-stages', contactId]` → `GET /api/kanban/contact/[contactId]/stages`. Chip(s) coloridos (cor da fase, nome curto "Vendas: Negociação"). Clique abre popover com as fases do board → troca (`PATCH cards/[id]`) e invalida. Sem funil → chip discreto "+ Funil" (popover lista boards → `POST cards`). Contato sem cadastro/conversa sem contact_id → não renderiza nada.
- [ ] **Step 2:** tsc + build ok. Commit: `git commit -m "feat(fase6): chip de fase do funil no inbox (ver/trocar)" -- components/features/inbox/ConversationHeader.tsx`

---

### Task 6: Fechamento

- [ ] **Step 1:** `npx vitest run` (sem regressão) + tsc + build.
- [ ] **Step 2:** Runbook `docs/superpowers/runbooks/2026-07-18-fase6-kanban.md`: entregue; migração aplicada; como usar campanha por fase (filtro de tag `funil/<board>: <fase>`); nota honesta sobre etiquetas do app WhatsApp (API não expõe; `wa_label_id` reservado); smoke test (criar funil, arrastar card, ver tag no contato, disparar campanha pela tag, trocar fase pelo inbox); rollback.
- [ ] **Step 3:** Commit runbook.

---

## Execução
T1 (controller, MCP) → T2 → T3 → [T4 ∥ T5 — arquivos disjuntos, ambos só dependem de T3] → T6. Cada agente com `git commit -- <paths>`. Review por camada; review final da branch antes do merge.
