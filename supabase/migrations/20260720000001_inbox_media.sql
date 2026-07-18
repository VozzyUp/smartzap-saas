-- Fase 5A: mídia no inbox. Colunas de mídia em inbox_messages + bucket privado
-- para os arquivos (imagem/documento/vídeo/áudio). Não-destrutivo.
begin;

alter table public.inbox_messages
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_filename text,
  add column if not exists media_size bigint,
  add column if not exists media_duration integer,
  add column if not exists media_status text not null default 'ready';

-- media_status: 'ready' (padrão; msgs sem mídia e mídia já disponível),
-- 'pending' (mídia recebida em download), 'failed' (download falhou).
alter table public.inbox_messages
  drop constraint if exists chk_inbox_messages_media_status;
alter table public.inbox_messages
  add constraint chk_inbox_messages_media_status
  check (media_status = any (array['ready'::text, 'pending'::text, 'failed'::text]));

-- Bucket PRIVADO para mídia do inbox (dado do cliente). Idempotente.
-- Acesso só via service role nas rotas server (que assinam URLs curtas);
-- sem policy de SELECT para 'authenticated', o token nunca vai ao client.
insert into storage.buckets (id, name, public)
values ('wa-inbox-media', 'wa-inbox-media', false)
on conflict (id) do nothing;

commit;
