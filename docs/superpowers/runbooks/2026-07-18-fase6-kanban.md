# Runbook — Fase 6: Kanban de clientes (funis de venda)

## O que foi entregue
- **Página `/kanban`** (menu "Funil"): múltiplos funis por tenant; colunas = fases com **nome/cor editáveis**; cards = clientes (nome, telefone, tempo na fase); **arrastar** card entre fases; adicionar cliente por busca; criar/renomear/excluir funis e fases.
- **Chip de fase no inbox**: na conversa, abaixo do nome do contato — mostra a(s) fase(s) do cliente com a cor; clique troca a fase ou adiciona ao funil, sem sair da conversa.
- **Campanha por fase**: cada mudança de fase mantém automaticamente a tag `funil/<Funil>: <Fase>` no contato. No wizard de campanha, filtre pela tag (ex.: `funil/Vendas: Negociação`) para disparar para todos os clientes daquela fase — sem mudança no fluxo de campanha.

## Modelo
- `kanban_boards` / `kanban_stages` / `kanban_cards` (tenant-scoped, RLS own-tenant). Card = contato; **1 fase por funil por contato** (`unique(board_id, contact_id)`); um cliente pode estar em vários funis.
- Novo funil nasce com 3 fases: **Novo** (azul), **Em andamento** (âmbar), **Concluído** (verde).
- Excluir fase com clientes → bloqueado (mova os clientes antes). Excluir funil remove as tags espelhadas.

## Etiquetas do WhatsApp Business (importante — expectativa correta)
A **API oficial (Cloud API) não expõe** endpoint para criar/aplicar etiquetas nos chats do app WhatsApp Business — nem em coexistência. As etiquetas do app continuam funcionando **dentro do app** normalmente, mas o SmartZap não consegue empurrá-las via API. O que fizemos: as fases têm cor (mesmo modelo visual de etiquetas) e a coluna `kanban_stages.wa_label_id` fica **reservada** para sincronizar no futuro se a Meta liberar o recurso (como Tech Provider, vale monitorar os betas).

## Migração aplicada (via MCP)
- `20260721000001_kanban.sql` — 3 tabelas + índices + RLS + GRANT. Verificado: 3 tabelas, 3 policies, unique ok.

## Dependência nova
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (drag & drop). Entram no build normalmente (npm install já no lockfile).

## Smoke test (pós-deploy)
1. `/kanban` → criar funil "Vendas" → nasce com 3 fases coloridas.
2. "Adicionar cliente" → buscar um contato → entra em "Novo". Conferir no contato (tela Contatos) que a tag `funil/Vendas: Novo` apareceu.
3. Arrastar o card para "Em andamento" → a tag troca para `funil/Vendas: Em andamento`.
4. Criar uma campanha filtrando pela tag `funil/Vendas: Em andamento` → o cliente entra na audiência.
5. No inbox, abrir a conversa do cliente → chip colorido "Vendas: Em andamento" sob o nome → clicar e trocar para "Concluído" → o quadro reflete.
6. Tentar excluir a fase com o cliente dentro → aviso "mova os clientes antes".

## Limitações conhecidas (follow-ups)
- Reordenar fases: a rota `POST /api/kanban/boards/[id]/stages/reorder` existe, mas a UI ainda não expõe (nova fase entra no fim).
- DnD validado por código/testes; teste manual no navegador recomendado no smoke test.

## Rollback
Reverter commits. Tabelas novas são independentes; tags `funil/...` remanescentes são inofensivas (remover manualmente se quiser). Nada destrutivo.
