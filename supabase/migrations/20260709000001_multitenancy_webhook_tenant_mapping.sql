-- Fase 2B: tabelas de mapeamento tenant p/ webhooks sem sessão (Meta WhatsApp,
-- Google Calendar). Ambas só são escritas/lidas via service_role em runtime
-- normal (resolução de tenant no webhook, write-through ao salvar credenciais);
-- a policy "own tenant" existe como defesa em profundidade e para uso futuro
-- de UI (ex.: Settings mostrando números conectados), não é o caminho principal.
begin;

create table if not exists public.whatsapp_phone_numbers (
  phone_number_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_account_id text,
  flows_webhook_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_phone_numbers_tenant_id
  on public.whatsapp_phone_numbers(tenant_id);

create table if not exists public.google_calendar_channels (
  channel_token text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id text,
  resource_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_google_calendar_channels_tenant_id
  on public.google_calendar_channels(tenant_id);

alter table public.whatsapp_phone_numbers enable row level security;
alter table public.google_calendar_channels enable row level security;

create policy "whatsapp_phone_numbers own tenant" on public.whatsapp_phone_numbers
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

create policy "google_calendar_channels own tenant" on public.google_calendar_channels
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_platform_admin((select auth.uid())))
  );

-- RLS sozinho não expõe a tabela via Data API/PostgREST — precisa do GRANT de
-- tabela também (achado no planejamento: as tabelas de plataforma da Fase 2A
-- também não têm esse GRANT; ver ledger, correção fica para o review final).
grant select, insert, update, delete on public.whatsapp_phone_numbers to authenticated;
grant select, insert, update, delete on public.google_calendar_channels to authenticated;

commit;
