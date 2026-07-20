-- Mesmo achado do get_advisors (security) que motivou a migração
-- 20260723000001 (process_inbound_message): `admin_list_tenants` e
-- `admin_tenant_users` também tinham EXECUTE concedido a PUBLIC por padrão
-- (toda função nova recebe esse grant), o que as tornava chamáveis por
-- `anon` via /rest/v1/rpc mesmo sendo SECURITY DEFINER.
--
-- `authenticated` PRECISA continuar podendo executar: a UI de admin chama
-- essas RPCs via o client de SESSÃO (createClient) para que `auth.uid()`
-- resolva dentro do check `is_platform_admin(auth.uid())` que a própria
-- função já faz internamente (bloqueando não-admins). Só removemos PUBLIC
-- e anon.
--
-- Já aplicado ao banco em produção via MCP (2026-07-20); esta migração só
-- versiona o estado no repo para reprodutibilidade em novos ambientes.
begin;

revoke execute on function public.admin_list_tenants() from public, anon;
revoke execute on function public.admin_tenant_users(uuid) from public, anon;

commit;
