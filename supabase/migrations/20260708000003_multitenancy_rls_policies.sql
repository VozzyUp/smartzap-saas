-- Fase 2A: RLS por tenant nas 38 tabelas de domínio.
--
-- Remove as policies da era single-tenant: anon_select_* (FOR SELECT TO anon
-- USING true) davam leitura anônima irrestrita — policies RLS combinam por OR,
-- então elas anulariam o isolamento multi-tenant. As deny_anon_select ficam
-- redundantes sem elas.
begin;

do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname='public'
      and (policyname like 'anon_select_%' or policyname = 'deny_anon_select')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end$$;

-- Funções envolvidas em (select ...) viram InitPlan: avaliadas 1x por query,
-- não 1x por linha.
do $$
declare
  t text;
  tables text[] := array[
    'account_alerts','ai_agent_logs','ai_agents','ai_embeddings','ai_knowledge_files',
    'attendant_tokens','campaign_batch_metrics','campaign_contacts','campaign_folders',
    'campaign_run_metrics','campaign_tag_assignments','campaign_tags','campaign_trace_events',
    'campaigns','contacts','custom_field_definitions','flow_submissions','flows',
    'inbox_conversation_labels','inbox_conversations','inbox_labels','inbox_messages',
    'inbox_quick_replies','lead_forms','phone_suppressions','push_subscriptions','settings',
    'template_project_items','template_projects','templates','whatsapp_status_events',
    'workflow_builder_executions','workflow_builder_logs','workflow_conversations',
    'workflow_run_logs','workflow_runs','workflow_versions','workflows'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "tenant_isolation_%s" on public.%I', t, t);
    execute format($f$
      create policy "tenant_isolation_%1$s" on public.%1$I
      as permissive
      for all
      to authenticated
      using (
        tenant_id = (select public.current_tenant_id())
        or (select public.is_platform_admin((select auth.uid())))
      )
      with check (
        tenant_id = (select public.current_tenant_id())
        or (select public.is_platform_admin((select auth.uid())))
      );
    $f$, t);
  end loop;
end$$;

commit;
