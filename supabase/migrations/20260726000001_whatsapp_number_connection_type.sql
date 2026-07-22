-- Distingue números cadastrados via API oficial (sem app no celular) dos
-- números em coexistência (WhatsApp Business app + API ao mesmo tempo).
-- Usado pra decidir se a assinatura do webhook tenta o campo
-- smb_message_echoes (só faz sentido em coexistência) e pra dar diagnóstico
-- melhor quando a ativação falhar (o erro #100 da Meta em coexistência
-- geralmente significa que o vínculo do app no celular não foi concluído).
-- Nullable: números já cadastrados antes desta coluna ficam sem tipo
-- definido — o código trata "sem tipo" como coexistência (mais permissivo,
-- comportamento idêntico ao que já existia).
begin;

alter table public.whatsapp_phone_numbers
  add column if not exists connection_type text
    check (connection_type is null or connection_type in ('official_api', 'coexistence'));

commit;
