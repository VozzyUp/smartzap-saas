-- supabase/migrations/20260714130001_plans.sql
-- Fase 3A: catálogo de planos + vínculo do tenant. Limite NULL = ilimitado.
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  max_whatsapp_numbers integer,
  max_contacts integer,
  max_templates integer,
  max_campaigns_per_month integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (slug, name, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month, sort_order) VALUES
  ('trial',  'Trial',   1, 100,   3,    2,    0),
  ('basico', 'Básico',  1, 5000,  30,   20,   1),
  ('pro',    'Pro',     3, 50000, NULL, NULL, 2);

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id);
UPDATE public.tenants SET plan_id = (SELECT id FROM public.plans WHERE slug='trial') WHERE plan_id IS NULL;

-- Catálogo global legível por qualquer usuário autenticado; escrita só via service role.
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read_authenticated ON public.plans FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.plans TO authenticated;
