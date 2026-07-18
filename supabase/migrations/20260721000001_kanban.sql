-- Fase 6: Kanban de clientes (funis). Card = contato; 1 fase por funil por
-- contato (unique board+contact). wa_label_id reservado (a Cloud API não expõe
-- etiquetas do app WhatsApp hoje). RLS own-tenant no padrão da Fase 2A.
begin;

create table if not exists public.kanban_boards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.kanban_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  position int not null default 0,
  wa_label_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.kanban_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  stage_id uuid not null references public.kanban_stages(id) on delete cascade,
  contact_id text not null references public.contacts(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now(),
  moved_at timestamptz not null default now(),
  unique (board_id, contact_id)
);

create index if not exists idx_kanban_boards_tenant on public.kanban_boards(tenant_id);
create index if not exists idx_kanban_stages_tenant on public.kanban_stages(tenant_id);
create index if not exists idx_kanban_stages_board on public.kanban_stages(board_id);
create index if not exists idx_kanban_cards_tenant on public.kanban_cards(tenant_id);
create index if not exists idx_kanban_cards_board on public.kanban_cards(board_id);
create index if not exists idx_kanban_cards_stage on public.kanban_cards(stage_id);
create index if not exists idx_kanban_cards_contact on public.kanban_cards(contact_id);

alter table public.kanban_boards enable row level security;
alter table public.kanban_stages enable row level security;
alter table public.kanban_cards enable row level security;

create policy "kanban_boards own tenant" on public.kanban_boards
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "kanban_stages own tenant" on public.kanban_stages
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "kanban_cards own tenant" on public.kanban_cards
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

grant select, insert, update, delete on public.kanban_boards to authenticated;
grant select, insert, update, delete on public.kanban_stages to authenticated;
grant select, insert, update, delete on public.kanban_cards to authenticated;

commit;
