// scripts/purge-dev-data.ts
// Limpeza pré-migração multi-tenant: TRUNCATE das 38 tabelas de domínio.
// Tabelas de plataforma (tenants, tenant_members, platform_admins, platform_settings)
// e o histórico de migrações são preservados.
import { Client } from 'pg'
import 'dotenv/config'

const DOMAIN_TABLES = [
  'account_alerts','ai_agent_logs','ai_agents','ai_embeddings','ai_knowledge_files',
  'attendant_tokens','campaign_batch_metrics','campaign_contacts','campaign_folders',
  'campaign_run_metrics','campaign_tag_assignments','campaign_tags','campaign_trace_events',
  'campaigns','contacts','custom_field_definitions','flow_submissions','flows',
  'inbox_conversation_labels','inbox_conversations','inbox_labels','inbox_messages',
  'inbox_quick_replies','lead_forms','phone_suppressions','push_subscriptions','settings',
  'template_project_items','template_projects','templates','whatsapp_status_events',
  'workflow_builder_executions','workflow_builder_logs','workflow_conversations',
  'workflow_run_logs','workflow_runs','workflow_versions','workflows',
]

const args = new Set(process.argv.slice(2))
if (!args.has('--yes-really-purge')) {
  console.error('Refusing to run without --yes-really-purge. This TRUNCATEs 38 tables.')
  process.exit(2)
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const sql = `truncate ${DOMAIN_TABLES.map(t => `public."${t}"`).join(', ')} restart identity cascade;`
  console.log('Running:', sql)
  await client.query(sql)
  console.log('OK — 38 tabelas de domínio truncadas.')
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
