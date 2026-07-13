-- Fase 2A: unique constraints da era single-tenant viram per-tenant.
-- Mantidas globais de propósito: lead_forms.slug e lead_forms.webhook_token
-- (roteiam página pública anônima — o tenant é derivado do slug/token),
-- attendant_tokens.token e flow_submissions.message_id (id global do Meta),
-- push_subscriptions.endpoint (endpoint de push é único por browser).
begin;
alter table public.contacts drop constraint contacts_phone_key;
alter table public.contacts add constraint contacts_tenant_phone_key unique (tenant_id, phone);

alter table public.templates drop constraint templates_name_language_key;
alter table public.templates add constraint templates_tenant_name_language_key unique (tenant_id, name, language);

alter table public.campaign_tags drop constraint campaign_tags_name_unique;
alter table public.campaign_tags add constraint campaign_tags_tenant_name_key unique (tenant_id, name);

alter table public.campaign_folders drop constraint campaign_folders_name_unique;
alter table public.campaign_folders add constraint campaign_folders_tenant_name_key unique (tenant_id, name);

alter table public.inbox_labels drop constraint inbox_labels_name_key;
alter table public.inbox_labels add constraint inbox_labels_tenant_name_key unique (tenant_id, name);

alter table public.inbox_quick_replies drop constraint inbox_quick_replies_shortcut_key;
alter table public.inbox_quick_replies add constraint inbox_quick_replies_tenant_shortcut_key unique (tenant_id, shortcut);

alter table public.custom_field_definitions drop constraint custom_field_definitions_entity_type_key_key;
alter table public.custom_field_definitions add constraint custom_field_definitions_tenant_entity_key_key unique (tenant_id, entity_type, key);

alter table public.phone_suppressions drop constraint phone_suppressions_phone_key;
alter table public.phone_suppressions add constraint phone_suppressions_tenant_phone_key unique (tenant_id, phone);
commit;
