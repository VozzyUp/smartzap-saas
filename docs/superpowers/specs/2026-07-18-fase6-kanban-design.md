# Fase 6 — Kanban de clientes (funis de venda) — Design

**Contexto:** O SmartZap tem contatos (`contacts`, com `tags jsonb` usadas como filtro de audiência nas campanhas), inbox e campanhas — mas nenhuma gestão visual de funil. Não existem tabelas de deal/pipeline/kanban. O usuário quer gestão de clientes por fases (funil de vendas etc.) estilo Kanban.

**Goal:** Quadros Kanban por tenant (múltiplos funis), onde **o card é o cliente** (contato) e cada cliente está em exatamente **1 fase por funil**. Arrastar = mudar fase. Fases com nome/cor/ordem editáveis. Integrações: fase visível/trocável no inbox e campanha por fase (via tag automática espelhada).

**Fora de escopo:** deals com valor R$/previsão; automações de movimento; relatórios de conversão; sincronização de etiquetas com o app WhatsApp Business (a Cloud API **não expõe** endpoint de labels, nem em coexistência — o campo `wa_label_id` fica reservado nullable para o futuro).

## Decisões (aprovadas no brainstorm)

- Card = **contato** (não deal). Múltiplos funis por tenant; 1 fase por funil por contato (`unique(board_id, contact_id)`).
- Fases editáveis (nome, **cor**, ordem). Cor no modelo visual de etiquetas do app WhatsApp Business.
- **Tag espelhada:** ao entrar/mudar de fase, manter no `contacts.tags` a tag `funil/<board>: <fase>` (removendo a da fase anterior). Assim o filtro de campanha por tags existente já atende "campanha para todos em Negociação" sem tocar no wizard.
- Inbox: chip da fase no painel da conversa, com troca rápida.
- Drag & drop com `@dnd-kit` (a menos que já exista dnd no repo — verificar antes).

## Global Constraints

- Tudo tenant-scoped: tabelas com `tenant_id NOT NULL` + RLS "own tenant" (mesmo padrão das tabelas da Fase 2A: policy com `current_tenant_id()`/`is_platform_admin`), GRANT p/ authenticated. Rotas resolvem tenant via `getTenantContext` → 401; nunca tocam dados de outro tenant.
- Tag espelhada usa o prefixo `funil/` — a troca de fase remove SÓ a tag antiga do mesmo board (nunca mexe nas outras tags do usuário).
- Migração versionada em `supabase/migrations/` E aplicada via MCP.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-6-kanban` a partir de `main`.

## Componentes

### 1. Schema — `<ts>_kanban.sql`
```sql
create table kanban_boards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create table kanban_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  board_id uuid not null references kanban_boards(id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  position int not null default 0,
  wa_label_id text, -- reservado: futuro sync de etiqueta (API não expõe hoje)
  created_at timestamptz not null default now()
);
create table kanban_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  board_id uuid not null references kanban_boards(id) on delete cascade,
  stage_id uuid not null references kanban_stages(id) on delete cascade,
  contact_id text not null references contacts(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  moved_at timestamptz not null default now(),
  unique (board_id, contact_id)
);
```
Índices por tenant_id/board_id/stage_id. RLS own-tenant + GRANT (padrão 2A). Seed opcional: nenhum board por padrão (o usuário cria o primeiro pela UI).

### 2. `lib/kanban.ts` — camada de dados (service role, tenant-scoped)
- `listBoards(tenantId)`; `createBoard(tenantId, name)` (cria com 3 fases padrão: "Novo" azul, "Em andamento" âmbar, "Concluído" verde); `renameBoard`; `deleteBoard`.
- `listStages(tenantId, boardId)`; `createStage(tenantId, boardId, { name, color })`; `updateStage` (nome/cor); `reorderStages(tenantId, boardId, orderedIds)`; `deleteStage` (bloqueia se tiver cards → 409, ou move para outra fase — decidir na implementação: bloquear é mais seguro).
- `getBoardData(tenantId, boardId)` — fases + cards com dados do contato (nome, phone, última interação) em 1 chamada para a UI.
- `addCardToBoard(tenantId, boardId, contactId, stageId?)` (default: 1ª fase); `moveCard(tenantId, cardId, { stageId, position })`; `removeCard(tenantId, cardId)`.
- `getContactStages(tenantId, contactId)` — [{board, stage}] para o chip do inbox.
- **Tag espelhada:** helper `syncStageTag(tenantId, contactId, boardName, oldStageName|null, newStageName|null)` — lê `contacts.tags`, remove `funil/<board>: <oldStage>`, adiciona `funil/<board>: <newStage>` (null = só remove; usado no removeCard/deleteBoard). Chamado por addCard/moveCard/removeCard. Renomear fase/board atualiza as tags dos contatos afetados (update em lote).

### 3. Rotas `/api/kanban/*`
- `GET/POST /api/kanban/boards`; `PATCH/DELETE /api/kanban/boards/[id]`.
- `GET /api/kanban/boards/[id]/data` (getBoardData).
- `POST /api/kanban/boards/[id]/stages`; `PATCH/DELETE /api/kanban/stages/[id]`; `POST /api/kanban/boards/[id]/stages/reorder`.
- `POST /api/kanban/boards/[id]/cards` ({contactId, stageId?}); `PATCH /api/kanban/cards/[id]` (move: {stageId, position}); `DELETE /api/kanban/cards/[id]`.
- Todas: `getTenantContext` → 401; operações escopadas por tenant.

### 4. UI — `/kanban`
- `app/(dashboard)/kanban/page.tsx` (client, React Query): seletor de funil (dropdown + criar); colunas por fase (header com cor, nome, contagem, menu editar/excluir); cards (nome, telefone, tempo na fase); botão "+ fase"; botão "adicionar cliente" (busca contato → entra na 1ª fase).
- **Drag & drop:** `@dnd-kit/core` + `@dnd-kit/sortable` (verificar se o repo já tem dnd; senão `npm install @dnd-kit/core @dnd-kit/sortable`). Arrastar entre colunas → `PATCH cards/[id]` (optimistic update + rollback em erro). Reordenar fases por drag no header (ou setas — o mais simples).
- Menu "Funil" no `DashboardShell.tsx` (mesmo padrão dos itens anteriores).

### 5. Inbox — chip de fase
- No `ConversationHeader` (ou painel de detalhes): chip(s) com a(s) fase(s) do contato (`getContactStages` via `GET /api/kanban/contact/[contactId]/stages`), cor da fase; clique abre dropdown com as fases do funil → troca (`PATCH cards/[id]` ou `POST cards` se ainda não está no funil).
- Se o contato não está em nenhum funil: chip "+ Funil" para adicionar rápido.

### 6. Campanha por fase
- Nada a mudar no wizard: a tag espelhada `funil/<board>: <fase>` já aparece no filtro de tags existente das campanhas. Documentar no runbook como usar.

## Data Flow
```
Arrastar card → PATCH /api/kanban/cards/[id] {stageId,position} → moveCard →
  update kanban_cards + syncStageTag (remove tag antiga, põe nova em contacts.tags)
Campanha "para fase X" → filtro de tags existente seleciona `funil/<board>: X`
Inbox → GET contact stages → chip colorido; troca → mesmo PATCH do quadro
```

## Error Handling
- Board/stage/card de outro tenant → 404. deleteStage com cards → 409 com mensagem clara.
- moveCard para stage de outro board → 400. addCard duplicado (unique) → 409 amigável ("cliente já está neste funil").
- syncStageTag é best-effort: falha na tag não desfaz o movimento do card (loga e segue; a tag se corrige no próximo movimento).

## Testing
- `lib/kanban.test.ts`: createBoard (3 fases padrão), addCard (1ª fase + tag), moveCard (troca tag antiga→nova, escopo por tenant), removeCard (remove tag), reorderStages, deleteStage com cards → erro, getContactStages.
- Rotas: 401 sem sessão; 404 outro tenant; move ok; add duplicado → 409.
- UI sem teste automatizado (padrão do repo). Suíte sem regressão; tsc/build limpos.

## Rollback
Reverter commits. Tabelas novas são independentes (drop opcional). Tags `funil/...` remanescentes podem ser removidas manualmente (inofensivas). Nada destrutivo em tabelas existentes.
