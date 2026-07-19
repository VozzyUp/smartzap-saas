-- Armazena o telefone de exibição retornado pela Meta para a lista de números.
alter table public.whatsapp_phone_numbers
  add column if not exists display_phone_number text;

-- A tabela tem SELECT por coluna; disponibiliza o telefone, mas nunca o token.
grant select (display_phone_number) on public.whatsapp_phone_numbers to authenticated;
