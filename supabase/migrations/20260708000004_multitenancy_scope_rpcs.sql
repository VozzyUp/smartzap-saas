-- Task 4b (Fase 2A) — Tenant-scoping das funções SECURITY DEFINER do baseline.
--
-- Estas funções são executadas via service_role (bypassa RLS) pelas rotas de API.
-- Pós multi-tenancy, precisam de p_tenant_id explícito para não vazar dados entre
-- tenants (agregações) ou permitir IDOR (lookups por id único).
--
-- Convenção: assinatura muda de tipos -> drop da assinatura antiga + create da nova
-- (evita overload fantasma). Mantido SECURITY DEFINER + search_path original de cada
-- função. Grants: revoke de public/anon/authenticated, grant apenas para service_role
-- (essas RPCs são chamadas só por rotas server-side com service_role). O revoke de
-- authenticated é necessário porque este projeto concede EXECUTE a esse role via
-- default privileges — revoke de public/anon sozinho não bloqueia authenticated
-- (confirmado via mcp__supabase__get_advisors: sem o revoke extra, authenticated
-- aparecia como capaz de chamar as 10 funções via /rest/v1/rpc/...).

-- =====================================================================
-- 1) get_contact_stats() -> get_contact_stats(p_tenant_id uuid)
-- =====================================================================
drop function if exists public.get_contact_stats();

create function public.get_contact_stats(p_tenant_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', COUNT(*),
        'optIn', COUNT(*) FILTER (WHERE status IN ('Opt-in', 'OPT_IN')),
        'optOut', COUNT(*) FILTER (WHERE status IN ('Opt-out', 'OPT_OUT'))
    ) INTO result
    FROM contacts
    WHERE tenant_id = p_tenant_id;

    RETURN COALESCE(result, '{"total":0,"optIn":0,"optOut":0}'::json);
END;
$function$;

revoke execute on function public.get_contact_stats(uuid) from public;
revoke execute on function public.get_contact_stats(uuid) from anon;
revoke execute on function public.get_contact_stats(uuid) from authenticated;
grant execute on function public.get_contact_stats(uuid) to service_role;

-- =====================================================================
-- 2) get_contact_tags() -> get_contact_tags(p_tenant_id uuid)
-- =====================================================================
drop function if exists public.get_contact_tags();

create function public.get_contact_tags(p_tenant_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
    result JSON;
BEGIN
    -- Extrai tags como texto e filtra vazios.
    -- jsonb_array_elements_text achata o primeiro nível automaticamente.
    SELECT COALESCE(json_agg(DISTINCT tag ORDER BY tag), '[]'::json) INTO result
    FROM contacts, jsonb_array_elements_text(tags) AS tag
    WHERE tenant_id = p_tenant_id
      AND tags IS NOT NULL
      AND jsonb_array_length(tags) > 0
      AND length(trim(tag)) > 0
      -- Ignora tags que parecem arrays serializados (proteção defensiva)
      AND tag NOT LIKE '[%]';

    RETURN COALESCE(result, '[]'::json);
END;
$function$;

revoke execute on function public.get_contact_tags(uuid) from public;
revoke execute on function public.get_contact_tags(uuid) from anon;
revoke execute on function public.get_contact_tags(uuid) from authenticated;
grant execute on function public.get_contact_tags(uuid) to service_role;

-- =====================================================================
-- 3) get_dashboard_stats() -> get_dashboard_stats(p_tenant_id uuid)
-- =====================================================================
drop function if exists public.get_dashboard_stats();

create function public.get_dashboard_stats(p_tenant_id uuid)
returns table(total_campaigns bigint, total_contacts bigint, total_sent bigint, total_delivered bigint, total_read bigint, total_failed bigint)
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.campaigns WHERE tenant_id = p_tenant_id)::bigint,
    (SELECT COUNT(*) FROM public.contacts WHERE tenant_id = p_tenant_id)::bigint,
    COALESCE((SELECT SUM(sent) FROM public.campaigns WHERE tenant_id = p_tenant_id), 0)::bigint,
    COALESCE((SELECT SUM(delivered) FROM public.campaigns WHERE tenant_id = p_tenant_id), 0)::bigint,
    COALESCE((SELECT SUM(read) FROM public.campaigns WHERE tenant_id = p_tenant_id), 0)::bigint,
    COALESCE((SELECT SUM(failed) FROM public.campaigns WHERE tenant_id = p_tenant_id), 0)::bigint;
END;
$function$;

revoke execute on function public.get_dashboard_stats(uuid) from public;
revoke execute on function public.get_dashboard_stats(uuid) from anon;
revoke execute on function public.get_dashboard_stats(uuid) from authenticated;
grant execute on function public.get_dashboard_stats(uuid) to service_role;

-- =====================================================================
-- 4) get_contact_tag_counts() -> get_contact_tag_counts(p_tenant_id uuid)
-- =====================================================================
drop function if exists public.get_contact_tag_counts();

create function public.get_contact_tag_counts(p_tenant_id uuid)
returns table(tag text, count bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
    RETURN QUERY
    SELECT t.tag, COUNT(*) AS count
    FROM (
        SELECT tags
        FROM contacts
        WHERE tenant_id = p_tenant_id
          AND tags IS NOT NULL
          AND jsonb_typeof(tags) = 'array'
          AND jsonb_array_length(tags) > 0
    ) c,
         jsonb_array_elements_text(c.tags) AS t(tag)
    WHERE length(trim(t.tag)) > 0
      AND trim(t.tag) NOT LIKE '[%]'
    GROUP BY t.tag
    ORDER BY count DESC, t.tag ASC;
END;
$function$;

revoke execute on function public.get_contact_tag_counts(uuid) from public;
revoke execute on function public.get_contact_tag_counts(uuid) from anon;
revoke execute on function public.get_contact_tag_counts(uuid) from authenticated;
grant execute on function public.get_contact_tag_counts(uuid) to service_role;

-- =====================================================================
-- 5) get_campaign_contact_stats(text) -> get_campaign_contact_stats(text, uuid)
--    IDOR fix: campaign_id é único globalmente, mas o chamador poderia passar
--    um id de campanha de outro tenant.
-- =====================================================================
drop function if exists public.get_campaign_contact_stats(text);

create function public.get_campaign_contact_stats(p_campaign_id text, p_tenant_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', COUNT(*),
        'pending', COUNT(*) FILTER (WHERE status IN ('pending', 'sending')),
        'sent', COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')),
        'delivered', COUNT(*) FILTER (WHERE status IN ('delivered', 'read')),
        'read', COUNT(*) FILTER (WHERE status = 'read'),
        'skipped', COUNT(*) FILTER (WHERE status = 'skipped'),
        'failed', COUNT(*) FILTER (WHERE status = 'failed')
    ) INTO result
    FROM campaign_contacts
    WHERE campaign_id = p_campaign_id
      AND tenant_id = p_tenant_id;

    RETURN COALESCE(result, '{"total":0,"pending":0,"sent":0,"delivered":0,"read":0,"skipped":0,"failed":0}'::json);
END;
$function$;

revoke execute on function public.get_campaign_contact_stats(text, uuid) from public;
revoke execute on function public.get_campaign_contact_stats(text, uuid) from anon;
revoke execute on function public.get_campaign_contact_stats(text, uuid) from authenticated;
grant execute on function public.get_campaign_contact_stats(text, uuid) to service_role;

-- =====================================================================
-- 6) get_campaigns_with_all_tags(uuid[]) -> get_campaigns_with_all_tags(uuid[], uuid)
--    IDOR fix: tag_ids são únicos globalmente; escopar por tenant evita
--    cruzar tags de outro tenant.
-- =====================================================================
drop function if exists public.get_campaigns_with_all_tags(uuid[]);

create function public.get_campaigns_with_all_tags(p_tag_ids uuid[], p_tenant_id uuid)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
    RETURN ARRAY(
        SELECT campaign_id
        FROM campaign_tag_assignments
        WHERE tag_id = ANY(p_tag_ids)
          AND tenant_id = p_tenant_id
        GROUP BY campaign_id
        HAVING COUNT(DISTINCT tag_id) = array_length(p_tag_ids, 1)
    );
END;
$function$;

revoke execute on function public.get_campaigns_with_all_tags(uuid[], uuid) from public;
revoke execute on function public.get_campaigns_with_all_tags(uuid[], uuid) from anon;
revoke execute on function public.get_campaigns_with_all_tags(uuid[], uuid) from authenticated;
grant execute on function public.get_campaigns_with_all_tags(uuid[], uuid) to service_role;

-- =====================================================================
-- 7) increment_campaign_stat — 2 overloads
--    IDOR fix: campaign id é único globalmente; escopar por tenant evita
--    incrementar estatísticas de campanha de outro tenant.
-- =====================================================================

-- overload (text, text)
drop function if exists public.increment_campaign_stat(text, text);

create function public.increment_campaign_stat(campaign_id_input text, field text, p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF field = 'sent' THEN
    UPDATE campaigns SET sent = COALESCE(sent, 0) + 1 WHERE id = campaign_id_input AND tenant_id = p_tenant_id;
  ELSIF field = 'delivered' THEN
    UPDATE campaigns SET delivered = COALESCE(delivered, 0) + 1 WHERE id = campaign_id_input AND tenant_id = p_tenant_id;
  ELSIF field = 'read' THEN
    UPDATE campaigns SET read = COALESCE(read, 0) + 1 WHERE id = campaign_id_input AND tenant_id = p_tenant_id;
  ELSIF field = 'failed' THEN
    UPDATE campaigns SET failed = COALESCE(failed, 0) + 1 WHERE id = campaign_id_input AND tenant_id = p_tenant_id;
  END IF;
END;
$function$;

revoke execute on function public.increment_campaign_stat(text, text, uuid) from public;
revoke execute on function public.increment_campaign_stat(text, text, uuid) from anon;
revoke execute on function public.increment_campaign_stat(text, text, uuid) from authenticated;
grant execute on function public.increment_campaign_stat(text, text, uuid) to service_role;

-- overload (uuid, text, int) — p_tenant_id inserido antes dos parâmetros com
-- DEFAULT (regra do Postgres: parâmetros sem default não podem vir depois de
-- parâmetros com default).
drop function if exists public.increment_campaign_stat(uuid, text, integer);

create function public.increment_campaign_stat(p_campaign_id uuid, p_tenant_id uuid, p_stat text, p_value integer DEFAULT 1)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  EXECUTE format(
    'UPDATE public.campaigns SET %I = COALESCE(%I, 0) + $1 WHERE id = $2 AND tenant_id = $3',
    p_stat, p_stat
  ) USING p_value, p_campaign_id, p_tenant_id;
END;
$function$;

revoke execute on function public.increment_campaign_stat(uuid, uuid, text, integer) from public;
revoke execute on function public.increment_campaign_stat(uuid, uuid, text, integer) from anon;
revoke execute on function public.increment_campaign_stat(uuid, uuid, text, integer) from authenticated;
grant execute on function public.increment_campaign_stat(uuid, uuid, text, integer) to service_role;

-- =====================================================================
-- 8) search_embeddings — 2 overloads
--    Com p_tenant_id, o overload com p_agent_id DEFAULT NULL passa a
--    significar "todos os agents DO tenant" em vez de "todos os agents".
-- =====================================================================

-- overload (vector, float, int, uuid DEFAULT NULL) -> insere p_tenant_id antes
-- dos parâmetros com DEFAULT.
drop function if exists public.search_embeddings(vector, double precision, integer, uuid);

create function public.search_embeddings(query_embedding vector, p_tenant_id uuid, match_threshold double precision DEFAULT 0.7, match_count integer DEFAULT 5, p_agent_id uuid DEFAULT NULL::uuid)
returns table(id uuid, content text, metadata jsonb, similarity double precision)
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.content,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM public.ai_embeddings e
  WHERE
    e.tenant_id = p_tenant_id
    AND (p_agent_id IS NULL OR e.agent_id = p_agent_id)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

revoke execute on function public.search_embeddings(vector, uuid, double precision, integer, uuid) from public;
revoke execute on function public.search_embeddings(vector, uuid, double precision, integer, uuid) from anon;
revoke execute on function public.search_embeddings(vector, uuid, double precision, integer, uuid) from authenticated;
grant execute on function public.search_embeddings(vector, uuid, double precision, integer, uuid) to service_role;

-- overload (vector, uuid, int, float DEFAULT 0.5, int DEFAULT 5) -> insere
-- p_tenant_id antes dos parâmetros com DEFAULT. p_tenant_id é obrigatório
-- (não NULL) já que agent_id_filter também é obrigatório neste overload.
drop function if exists public.search_embeddings(vector, uuid, integer, double precision, integer);

create function public.search_embeddings(query_embedding vector, agent_id_filter uuid, expected_dimensions integer, p_tenant_id uuid, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 5)
returns table(id uuid, content text, similarity double precision, metadata jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.content,
    (1 - (e.embedding <=> query_embedding))::FLOAT AS similarity,
    e.metadata
  FROM ai_embeddings e
  WHERE e.agent_id = agent_id_filter
    AND e.tenant_id = p_tenant_id
    AND e.dimensions = expected_dimensions
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

revoke execute on function public.search_embeddings(vector, uuid, integer, uuid, double precision, integer) from public;
revoke execute on function public.search_embeddings(vector, uuid, integer, uuid, double precision, integer) from anon;
revoke execute on function public.search_embeddings(vector, uuid, integer, uuid, double precision, integer) from authenticated;
grant execute on function public.search_embeddings(vector, uuid, integer, uuid, double precision, integer) to service_role;
