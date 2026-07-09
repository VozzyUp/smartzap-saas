-- Fase 2A: tenant_id NOT NULL + índice nas 38 tabelas de domínio.
-- Sem backfill: SaaS net-new, dados de dev truncados antes (scripts/purge-dev-data.ts).
begin;

do $$
declare
  t text;
  tables text[] := array[
    'account_alerts','ai_agent_logs','ai_agents','ai_embeddings','ai_knowledge_files',
    'attendant_tokens','campaign_batch_metrics','campaign_contacts','campaign_folders',
    'campaign_run_metrics','campaign_tag_assignments','campaign_tags','campaign_trace_events',
    'campaigns','contacts','custom_field_definitions','flow_submissions','flows',
    'inbox_conversation_labels','inbox_conversations','inbox_labels','inbox_messages',
    'inbox_quick_replies','lead_forms','phone_suppressions','push_subscriptions',
    'template_project_items','template_projects','templates','whatsapp_status_events',
    'workflow_builder_executions','workflow_builder_logs','workflow_conversations',
    'workflow_run_logs','workflow_runs','workflow_versions','workflows'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column tenant_id uuid not null references public.tenants(id) on delete cascade',
      t
    );
    execute format(
      'create index if not exists %I on public.%I(tenant_id)',
      'idx_' || t || '_tenant_id', t
    );
  end loop;
end$$;

-- settings vira per-tenant: PK composta (tenant_id, key)
alter table public.settings drop constraint if exists settings_pkey;
alter table public.settings add column tenant_id uuid not null references public.tenants(id) on delete cascade;
alter table public.settings add primary key (tenant_id, key);
create index if not exists idx_settings_tenant_id on public.settings(tenant_id);

commit;
