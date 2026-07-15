-- supabase/migrations/20260715000001_admin_panel.sql
-- Fase 3B: suspensão de tenant + RPCs do painel admin.
-- tenants.status já é text; valores usados: 'trialing' | 'active' | 'suspended'.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Lista agregada de tenants com uso vs limite (1 query, sem N+1). Só platform admin.
CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE (
  id uuid, name text, slug text, status text, trial_ends_at timestamptz, suspended_at timestamptz,
  plan_slug text, plan_name text,
  max_contacts integer, max_templates integer, max_campaigns_per_month integer, max_whatsapp_numbers integer,
  used_contacts bigint, used_templates bigint, used_campaigns_month bigint, used_whatsapp_numbers bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.status, t.trial_ends_at, t.suspended_at,
    p.slug, p.name, p.max_contacts, p.max_templates, p.max_campaigns_per_month, p.max_whatsapp_numbers,
    (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id),
    (SELECT count(*) FROM templates te WHERE te.tenant_id = t.id),
    (SELECT count(*) FROM campaigns ca WHERE ca.tenant_id = t.id AND ca.created_at >= date_trunc('month', now())),
    (SELECT count(*) FROM whatsapp_phone_numbers w WHERE w.tenant_id = t.id)
  FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
  ORDER BY t.created_at;
END; $$;

-- Usuários de um tenant (com e-mail de auth.users). Só platform admin.
CREATE OR REPLACE FUNCTION public.admin_tenant_users(p_tenant_id uuid)
RETURNS TABLE (user_id uuid, email text, role text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT tm.user_id, u.email::text, tm.role, tm.created_at
  FROM tenant_members tm JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id
  ORDER BY tm.created_at;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_list_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tenant_users(uuid) TO authenticated;
