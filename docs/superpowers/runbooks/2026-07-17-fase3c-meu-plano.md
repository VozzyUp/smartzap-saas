# Runbook — Fase 3C: Meu Plano (usuário final)

## O que foi entregue
- Página `/settings/plano` (cliente): plano atual + preço, badge de trial (dias restantes), uso vs limite das 4 dimensões (contatos, templates, campanhas/mês, números), comparativo dos 3 planos com preço, botão "Falar com o time" → WhatsApp `+55 11 97619-4739`.
- Card "Meu Plano" no Dashboard (resumo + link) e item de menu "Meu Plano".
- Backend: `plans.price_cents` (editável no `/admin/plans`), `lib/plan-usage` (snapshot de uso), rotas `GET /api/plan` e `GET /api/plans/catalog`.
- Mensagem amigável: ao estourar um limite, toast "Seu plano permite até N X — faça upgrade" com ação "Ver meu plano" → `/settings/plano`.
- Migração `supabase/migrations/20260717000001_plan_price.sql`, já aplicada via MCP.

## OBRIGATÓRIO pós-deploy: definir os preços
Os planos vêm com `price_cents = NULL` (aparecem como "Sob consulta"). Defina os preços do Básico e Pro:
- **Pela tela**: `/admin/plans` → editar cada plano → campo Preço (em reais, ex.: "49,90") → Salvar.
- **Ou por SQL** (centavos): `UPDATE plans SET price_cents = 4990 WHERE slug='basico';` `UPDATE plans SET price_cents = 14990 WHERE slug='pro';` (Trial fica NULL = "Grátis").

## Smoke test
1. Como cliente, abrir `/settings/plano`: uso vs limite corretos (ex.: "Contatos 1/100"), badge de trial com dias, comparativo com os preços definidos.
2. Card "Meu Plano" no dashboard mostra o resumo e leva à página.
3. Estourar um limite (ex.: no trial, criar o 4º template) → toast "Seu plano permite até 3 templates — faça upgrade" com botão "Ver meu plano".
4. Clicar em "Falar com o time" → abre o WhatsApp `5511976194739` com mensagem pré-preenchida.

## Notas
- Sem gateway: upgrade é conversa manual; você troca o plano do tenant pelo `/admin` (Fase 3B).
- Preço editável a qualquer momento pelo `/admin/plans`, sem deploy.
