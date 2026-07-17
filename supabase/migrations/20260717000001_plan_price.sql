-- supabase/migrations/20260717000001_plan_price.sql
-- Fase 3C: preço mensal do plano (centavos BRL). NULL = grátis/sob consulta.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS price_cents integer;
