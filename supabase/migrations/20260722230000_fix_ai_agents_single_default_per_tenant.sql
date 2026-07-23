-- idx_ai_agents_single_default era um índice único GLOBAL em is_default,
-- não por tenant: "CREATE UNIQUE INDEX ... ON ai_agents (is_default) WHERE
-- (is_default = true)". Isso permitia UM ÚNICO agente padrão em todo o
-- banco - qualquer tenant que já tivesse um agente padrão bloqueava TODOS
-- os outros tenants de criar o deles (erro "duplicate key value violates
-- unique constraint" ao criar o primeiro agente, mascarado como "Failed to
-- create AI agent" pela rota).
--
-- Corrige pra escopo por tenant: no máximo um agente padrão POR TENANT, que
-- é a regra que o código em app/api/ai-agents/route.ts já pressupõe (o
-- "unset outros defaults" já filtra por tenant_id).
--
-- Seguro: o índice antigo só permitia 1 linha com is_default=true no banco
-- inteiro, então os dados atuais já satisfazem trivialmente a versão nova
-- (mais permissiva) por tenant.
begin;

drop index if exists public.idx_ai_agents_single_default;

create unique index idx_ai_agents_single_default
  on public.ai_agents (tenant_id)
  where (is_default = true);

commit;
