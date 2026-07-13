begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  status text not null default 'trialing' check (status in ('trialing','active','suspended')),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists idx_tenant_members_user_id on public.tenant_members(user_id);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- SECURITY DEFINER: precisam ler tenant_members/platform_admins sem disparar a RLS
-- dessas próprias tabelas (evita recursão infinita nas policies que as chamam).
-- order by torna o resultado determinístico quando o usuário pertence a >1 tenant.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid()
  order by tm.created_at, tm.tenant_id
  limit 1;
$$;

create or replace function public.is_platform_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.platform_admins where user_id = uid);
$$;

-- Postgres concede EXECUTE a PUBLIC por default em toda função nova.
-- Sem estes REVOKE, ambas seriam calláveis por anon.
revoke execute on function public.current_tenant_id() from public;
revoke execute on function public.is_platform_admin(uuid) from public;
grant execute on function public.current_tenant_id() to authenticated, service_role;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

-- Projetos Supabase concedem EXECUTE a `anon`/`authenticated` via ALTER DEFAULT
-- PRIVILEGES em novas funções do schema public, independente do REVOKE ... FROM
-- PUBLIC acima (esse revoke não afeta grants diretos para roles específicos).
-- O advisor de segurança confirmou `anon` com EXECUTE mesmo após os REVOKEs
-- anteriores; revogamos explicitamente para essa role.
revoke execute on function public.current_tenant_id() from anon;
revoke execute on function public.is_platform_admin(uuid) from anon;

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;

-- Chamadas de função envolvidas em (select ...) viram InitPlan: avaliadas uma vez
-- por query, não uma vez por linha.
create policy "tenant_members self read" on public.tenant_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "tenants self read" on public.tenants
  for select to authenticated
  using (
    id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "platform_admins self read" on public.platform_admins
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "platform_settings admin only" on public.platform_settings
  for all to authenticated
  using ( (select public.is_platform_admin((select auth.uid()))) )
  with check ( (select public.is_platform_admin((select auth.uid()))) );

commit;
