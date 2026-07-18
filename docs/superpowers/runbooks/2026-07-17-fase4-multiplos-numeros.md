# Runbook — Fase 4: Múltiplos números WhatsApp por tenant

## O que foi entregue
- Um tenant pode cadastrar **vários números WhatsApp**, limitados pelo plano (`plans.max_whatsapp_numbers`), com modelo de **número ativo**:
  - Envios novos (campanhas, primeira mensagem) usam o número **ativo**.
  - Respostas do inbox saem **do número em que a conversa chegou** (exigência da API do WhatsApp), não do ativo.
- Tela **Configurações › Números de WhatsApp** (`/settings/numeros`): listar, adicionar (com validação na Meta), definir ativo, remover. Ao estourar o limite do plano → toast "Seu plano permite até N números — faça upgrade" com atalho para `/settings/plano`.
- Backend: `whatsapp_phone_numbers` passou a guardar credenciais por número (`access_token`, `display_label`, `is_active`); rotas `GET/POST /api/whatsapp-numbers`, `POST /api/whatsapp-numbers/[id]/activate`, `DELETE /api/whatsapp-numbers/[id]`.

## Arquitetura (resumo)
- **Fonte de verdade por número:** `whatsapp_phone_numbers` (PK `phone_number_id`). O número ativo é **espelhado em `settings`** (`mirrorActiveToSettings`) para manter compat com as 47 leituras legadas de `getWhatsAppCredentials` e com `isWhatsAppConnected`/health-check — nada nos 47 call-sites mudou.
- `getWhatsAppCredentials(tenantId)`: **ativa-first** (lê o número ativo) com **fallback para `settings`** (tenants sem linha ativa). Assinatura/retorno inalterados.
- `getWhatsAppCredentialsForNumber(tenantId, phoneNumberId)`: usado pelo reply do inbox; `null` → delega ao ativo/legado.
- **Recebimento:** a RPC `process_inbound_message` ganhou `p_phone_number_id` (DEFAULT NULL) e grava `inbox_conversations.whatsapp_number_id` — o webhook passa o `phone_number_id` do metadata da Meta.
- **Segurança:** `access_token` nunca volta ao browser — GRANT por coluna na tabela (revoga SELECT amplo de `authenticated`, concede só colunas seguras); só o service role lê o token.

## Migrações aplicadas (via MCP)
1. `20260718000001_multi_numbers.sql` — colunas (`access_token`, `display_label`, `is_active`), índice único parcial `uq_wa_active_per_tenant` (1 ativo/tenant), coluna `inbox_conversations.whatsapp_number_id` (FK ON DELETE SET NULL), GRANT por coluna, **backfill** (o número atual de cada tenant virou a linha ativa com token). Verificado: 2 tenants → 2 ativos, 2 tokens.
2. `20260719000001_process_inbound_message_whatsapp_number_id.sql` — RPC atualizada. **Importante:** dropa a sobrecarga de 8 args antes de recriar a de 9 (com `p_phone_number_id` DEFAULT NULL) para evitar "function is not unique" nas chamadas de 8 args da imagem em produção. Verificado: existe 1 única função de 9 args.

Ambas já aplicadas no projeto Supabase. A ordem importa: a RPC (migração 2) já foi aplicada, então a imagem atual (chamada de 8 args) e a nova (9 args) funcionam.

## Smoke test (pós-deploy da nova imagem)
1. `/settings/numeros`: o número atual aparece com badge "Ativo".
2. Adicionar um 2º número: no limite do plano (Trial permite 1) → toast "Seu plano permite até 1 números — faça upgrade" com "Ver meu plano". Aumente o limite pelo `/admin` e adicione — entra como não-ativo.
3. "Definir como ativo" no 2º número → vira ativo; enviar uma campanha usa esse número.
4. Receber uma mensagem no número B (não-ativo) e responder pelo inbox → a resposta sai por B (não pelo ativo). Conferir no WhatsApp do cliente que a resposta veio do número B.
5. Remover um número não-ativo → some da lista; remover o ativo → outro é promovido a ativo (ou, sem sobra, o tenant fica "desconectado").

## Rollback
Reverter os commits da branch. As colunas novas (`access_token`/`display_label`/`is_active`/`whatsapp_number_id`) são inertes (nullable/default false). Sem linha ativa, `getWhatsAppCredentials` volta a ler `settings` — comportamento idêntico ao pré-Fase 4. `settings` nunca é apagado. A RPC de 9 args atende chamadas de 8 args, então reverter só o código (mantendo a RPC) também é seguro.

## Notas
- Sem gateway: o upgrade continua sendo conversa manual (troca de plano pelo `/admin`, Fase 3B), o botão leva ao WhatsApp de suporte via `/settings/plano` (Fase 3C).
- Passo pós-merge: fazer deploy da imagem `sha-<short>` gerada pelo CI para a branch, como nas fases anteriores.
- Ponto observado no review (não bloqueante): `addWhatsAppNumber` faz upsert por `phone_number_id`; adicionar um número que já é de outro tenant reatribui a linha, mas exige o `access_token` válido do número na Meta (mesmo comportamento da rota de credenciais legada).
