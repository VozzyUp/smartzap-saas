-- Fase 4: múltiplos números WhatsApp por tenant. whatsapp_phone_numbers passa a
-- guardar credenciais por número + número ativo. Não-destrutivo: sem is_active,
-- getWhatsAppCredentials continua lendo settings (fallback).
begin;

alter table public.whatsapp_phone_numbers
  add column if not exists access_token text,
  add column if not exists display_label text,
  add column if not exists is_active boolean not null default false;

-- No máximo 1 número ativo por tenant.
create unique index if not exists uq_wa_active_per_tenant
  on public.whatsapp_phone_numbers (tenant_id) where is_active;

-- Conversa "pertence" ao número em que chegou (nullable; antigas = null → ativo).
alter table public.inbox_conversations
  add column if not exists whatsapp_number_id text
  references public.whatsapp_phone_numbers(phone_number_id) on delete set null;

-- Segurança por coluna: access_token ilegível via PostgREST (mesmo p/ o próprio
-- tenant); só service role o lê. INSERT/UPDATE/DELETE seguem concedidos.
revoke select on public.whatsapp_phone_numbers from authenticated;
grant select (phone_number_id, tenant_id, business_account_id, display_label,
  is_active, flows_webhook_token, created_at, updated_at)
  on public.whatsapp_phone_numbers to authenticated;

-- Backfill: o número atual de cada tenant (em settings key/value) vira a linha ativa.
with cur as (
  select
    s_pn.tenant_id,
    s_pn.value  as phone_number_id,
    s_ba.value  as business_account_id,
    s_at.value  as access_token
  from public.settings s_pn
  left join public.settings s_ba
    on s_ba.tenant_id = s_pn.tenant_id and s_ba.key = 'businessAccountId'
  left join public.settings s_at
    on s_at.tenant_id = s_pn.tenant_id and s_at.key = 'accessToken'
  where s_pn.key = 'phoneNumberId'
    and coalesce(s_pn.value, '') <> ''
)
insert into public.whatsapp_phone_numbers
  (phone_number_id, tenant_id, business_account_id, access_token, is_active, updated_at)
select cur.phone_number_id, cur.tenant_id, cur.business_account_id, cur.access_token, true, now()
from cur
on conflict (phone_number_id) do update
  set business_account_id = coalesce(public.whatsapp_phone_numbers.business_account_id, excluded.business_account_id),
      access_token        = coalesce(public.whatsapp_phone_numbers.access_token, excluded.access_token),
      is_active           = true,
      updated_at          = now();

commit;
