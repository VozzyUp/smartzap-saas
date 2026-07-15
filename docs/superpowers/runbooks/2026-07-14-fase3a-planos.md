# Runbook — Fase 3A: Planos + Limites

## O que foi entregue
- Tabela `plans` (catálogo global editável) + `tenants.plan_id`. Migração `supabase/migrations/20260714130001_plans.sql`, já aplicada no projeto via MCP.
- 3 planos: `trial` (1 número / 100 contatos / 3 templates / 2 campanhas-mês), `basico` (1 / 5000 / 30 / 20), `pro` (3 / 50000 / ∞ / ∞). `NULL` = ilimitado.
- `lib/plan-limits.ts` — gate server-side (fail-closed: sem plano → trial; erro de leitura → bloqueia).
- Gate aplicado em: criar contato, importar contatos (tamanho do lote), criar template (escala p/ lote), criar campanha (mês corrente UTC), conectar número (só número novo, não bloqueia reconexão). Platform admin nunca é limitado.
- Ao estourar: 403 `{ error:'plan_limit', dimension, limit, current }`.

## Verificação pós-deploy
- `SELECT slug, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month FROM plans ORDER BY sort_order;` → 3 linhas.
- `SELECT count(*) FROM tenants WHERE plan_id IS NULL;` → 0.

## Operação manual (até a tela de admin da Fase 3B)

### Trocar o plano de um tenant
```sql
UPDATE tenants
SET plan_id = (SELECT id FROM plans WHERE slug='pro'), trial_ends_at = NULL
WHERE slug = '<tenant-slug>';
```
Zerar `trial_ends_at` ao promover para plano pago tira o bloqueio de tempo do trial.

### Ajustar um limite (efeito imediato, sem deploy)
```sql
UPDATE plans SET max_contacts = 10000, updated_at = now() WHERE slug='basico';
```

## Smoke test
Tenant no `trial`: criar 3 templates OK, 4º → 403 `plan_limit` (templates); importar >100 contatos → 403; 3ª campanha do mês → 403. Platform admin nunca bloqueado.

## Notas
- Limite de **números** só terá efeito prático com a frente 4 (multi-número); hoje o fluxo de credenciais é upsert de 1 número por tenant.
- Front ainda mostra o erro cru `plan_limit`; tradução amigável e tela de gestão são da Fase 3B.
