-- Remove o overload pré-multitenancy de process_inbound_message (sem p_tenant_id),
-- deixado para trás pelo CREATE OR REPLACE anterior (assinatura mudou = novo overload,
-- não substituição). Manter os dois seria um caminho de escrita sem tenant ainda acessível.
DROP FUNCTION IF EXISTS public.process_inbound_message(text, text, text, text, text, jsonb, text);
