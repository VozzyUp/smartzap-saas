# Runbook — Fase 3B: Painel de Administrador

## O que foi entregue
- Rota `/admin` (só platform_admin): lista de tenants (uso real vs limite via RPC `admin_list_tenants`), detalhe do tenant (trocar plano, suspender/reativar, ver usuários em leitura), e edição dos limites dos planos.
- Rotas `/api/admin/*` — todas revalidam `requirePlatformAdmin()` → 403 se não-admin. RPCs `admin_*` também checam `is_platform_admin` internamente (defesa em profundidade).
- Suspensão: `tenants.status='suspended'` + `suspended_at`. Gate no layout do dashboard redireciona tenant suspenso para `/conta-suspensa`. Reativar → `status='active'`.
- Migração `supabase/migrations/20260715000001_admin_panel.sql`, já aplicada via MCP.

## Promover o primeiro super-admin (OBRIGATÓRIO para acessar /admin)
`is_platform_admin(uid)` consulta a tabela `platform_admins(user_id)`. Rode no SQL do Supabase (ou via MCP):
```sql
INSERT INTO platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'fernando.rodrigues.a@gmail.com'
ON CONFLICT DO NOTHING;
-- conferir:
SELECT public.is_platform_admin((SELECT id FROM auth.users WHERE email='fernando.rodrigues.a@gmail.com'));  -- true
```
Após isso, faça logout/login para o contexto de sessão recarregar `isPlatformAdmin`, e o item "Admin" aparece no menu.

## Operação
- **Trocar plano / suspender**: `/admin` → clicar no tenant → usar o select de plano ou o botão Suspender/Reativar. Por SQL: `UPDATE tenants SET status='suspended', suspended_at=now() WHERE slug='<slug>'` (e `status='active', suspended_at=null` para reativar).
- **Editar limites de plano**: `/admin/plans` → ajustar os números → Salvar (efeito imediato, sem deploy).

## Smoke test pós-deploy
1. Promover-se admin (acima) → logout/login → item "Admin" aparece.
2. `/admin` carrega a lista de tenants com uso real (ex.: contatos 4/100).
3. Abrir um tenant → trocar plano (confirma no banco `plan_id` mudou e `trial_ends_at` zerado ao promover).
4. Suspender um tenant de teste → logar como ele → cai em `/conta-suspensa`. Reativar → volta ao normal.
5. Editar um limite em `/admin/plans` → confirma persistência.
6. Usuário não-admin acessando `/admin` → redirecionado para `/`; chamada a `/api/admin/tenants` → 403.

## Notas
- Detalhe do tenant não mostra "uso vs limite" (só a lista mostra, via RPC); o select de plano no detalhe busca `/api/admin/plans` no client. Melhoria opcional futura.
- Gestão *editável* de usuários (criar/remover/dar acesso) não está no admin — é candidata a uma fase futura de "gestão de equipe do tenant" pelo próprio owner.
