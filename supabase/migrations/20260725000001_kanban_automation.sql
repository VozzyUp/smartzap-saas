-- Automação de Kanban por eventos de conversa + follow-up configurável.
-- Regras de produto embutidas no schema (não apenas na app layer):
--   - kanban_board_automations.active é o kill switch por board.
--   - kanban_cards.automation_paused é o kill switch por card.
--   - kanban_card_automation_log é a fonte da timeline visível ao usuário
--     (todo movimento/follow-up automático precisa ficar auditável).
-- RLS no mesmo padrão de 20260721000001_kanban.sql (current_tenant_id()).
begin;

create table if not exists public.kanban_board_automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  event_type text not null check (event_type in ('message_sent', 'client_replied', 'quote_detected')),
  target_stage_id uuid not null references public.kanban_stages(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, event_type)
);

create table if not exists public.kanban_automation_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  window_start time not null default '09:00',
  window_end time not null default '18:00',
  -- bitmask dom..sab (bit 0 = domingo .. bit 6 = sábado); default = seg-sex
  weekdays_mask int not null default 62,
  stale_stage_id uuid references public.kanban_stages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id)
);

create table if not exists public.kanban_stage_followup_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage_id uuid not null references public.kanban_stages(id) on delete cascade,
  day_offset int not null check (day_offset > 0),
  position int not null default 0,
  template_text text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.kanban_cards
  add column if not exists last_inbound_at timestamptz,
  add column if not exists next_followup_index int not null default 0,
  add column if not exists automation_paused boolean not null default false,
  add column if not exists last_manual_move_at timestamptz;

create table if not exists public.kanban_card_automation_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  card_id uuid not null references public.kanban_cards(id) on delete cascade,
  event_type text not null check (event_type in ('stage_moved', 'followup_sent')),
  source text not null check (source in ('ai', 'keyword', 'system', 'manual')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Idempotência do follow-up: nunca manda a mesma regra duas vezes pro mesmo card.
create unique index if not exists idx_kanban_card_automation_log_followup_dedupe
  on public.kanban_card_automation_log (card_id, (detail ->> 'rule_id'))
  where event_type = 'followup_sent';

create table if not exists public.kanban_quote_keywords (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  keyword text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, keyword)
);

create index if not exists idx_kanban_board_automations_tenant on public.kanban_board_automations(tenant_id);
create index if not exists idx_kanban_board_automations_board on public.kanban_board_automations(board_id);
create index if not exists idx_kanban_automation_settings_tenant on public.kanban_automation_settings(tenant_id);
create index if not exists idx_kanban_stage_followup_rules_tenant on public.kanban_stage_followup_rules(tenant_id);
create index if not exists idx_kanban_stage_followup_rules_stage on public.kanban_stage_followup_rules(stage_id);
create index if not exists idx_kanban_card_automation_log_tenant on public.kanban_card_automation_log(tenant_id);
create index if not exists idx_kanban_card_automation_log_card on public.kanban_card_automation_log(card_id);
create index if not exists idx_kanban_quote_keywords_tenant on public.kanban_quote_keywords(tenant_id);

alter table public.kanban_board_automations enable row level security;
alter table public.kanban_automation_settings enable row level security;
alter table public.kanban_stage_followup_rules enable row level security;
alter table public.kanban_card_automation_log enable row level security;
alter table public.kanban_quote_keywords enable row level security;

create policy "kanban_board_automations own tenant" on public.kanban_board_automations
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "kanban_automation_settings own tenant" on public.kanban_automation_settings
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "kanban_stage_followup_rules own tenant" on public.kanban_stage_followup_rules
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "kanban_card_automation_log own tenant" on public.kanban_card_automation_log
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "kanban_quote_keywords own tenant" on public.kanban_quote_keywords
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

grant select, insert, update, delete on public.kanban_board_automations to authenticated;
grant select, insert, update, delete on public.kanban_automation_settings to authenticated;
grant select, insert, update, delete on public.kanban_stage_followup_rules to authenticated;
grant select, insert, update, delete on public.kanban_card_automation_log to authenticated;
grant select, insert, update, delete on public.kanban_quote_keywords to authenticated;

commit;
