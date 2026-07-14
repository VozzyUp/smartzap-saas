# Fase 3.2 — Login por e-mail/senha + trial de 3 dias — Design

**Contexto:** Hoje a autenticação é exclusivamente magic link (Supabase Auth OTP por e-mail). O primeiro login provisiona o tenant automaticamente (`lib/tenant-context.ts` / fluxo de callback). O magic link esbarra no rate limit do SMTP embutido do Supabase e adiciona fricção no login diário. Decisão do produto: **só senha** — o magic link sai; o único e-mail transacional que permanece é confirmação de cadastro e reset de senha.

**Goal:** Login e cadastro por e-mail+senha com confirmação de e-mail; todo tenant novo nasce com trial de 3 dias; trial expirado bloqueia o app numa tela de contato/upgrade, preservando os dados.

**Decomposição da Fase 3 (contexto):** (1) verificação funcional em produção → **(2) esta spec** → (3) painel admin + planos → (4) multi-número por plano. `trial_ends_at` criado aqui é absorvido pelo modelo de planos na frente 3.

## Global Constraints

- Supabase Auth continua sendo o provedor — nada de tabela própria de senhas.
- Confirmação de e-mail LIGADA no signup (anti-abuso; trial grátis sem confirmação = spam de tenants).
- Tenants existentes: `trial_ends_at = NULL` = sem limite (grandfathered). Platform admin nunca é bloqueado por trial.
- Falha fechada: sem sessão → `/login`; trial expirado → `/trial-expirado`; nunca 500 por gate.
- Todo redirect absoluto usa `getAppUrl()` (lição da 2B — nunca `request.url`).
- Baseline: `tsc --noEmit` limpo, `npx vitest run` = 3456 passed / 6 skipped, `npm run build` ok. Sem regressão.
- Supabase dashboard: templates de e-mail de "Confirm signup" e "Reset password" precisam das Redirect URLs de produção já configuradas (mesma tela da 2B: Auth → URL Configuration).

## Componentes

### 1. Auth — telas e rotas

**`app/login/page.tsx` (modificar):** formulário e-mail+senha → `supabase.auth.signInWithPassword({ email, password })` (client-side, `lib/supabase-browser.ts`). Remove o formulário de magic link. Links: "Criar conta" → `/signup`; "Esqueci minha senha" → `/forgot-password`.

**`app/signup/page.tsx` (novo):** e-mail + senha + confirmar senha → `supabase.auth.signUp({ email, password, options: { emailRedirectTo: getAppUrl() + '/api/auth/callback' } })`. Mensagem pós-submit: "confira seu e-mail para confirmar o cadastro". Validação: senha mínima 8 caracteres (config do Supabase Auth alinhada).

**`app/forgot-password/page.tsx` (novo):** e-mail → `supabase.auth.resetPasswordForEmail(email, { redirectTo: getAppUrl() + '/reset-password' })`.

**`app/reset-password/page.tsx` (novo):** nova senha + confirmação → `supabase.auth.updateUser({ password })` (a sessão de recovery vem do link do e-mail). É também o caminho para contas pré-existentes (criadas por magic link) definirem senha.

**Remover:** `app/api/auth/magic-link/route.ts` e o formulário/fluxo de magic link na tela de login. O callback `app/api/auth/callback/route.ts` permanece — confirma signup e recovery (troca `?code=` por sessão) e continua provisionando tenant no primeiro login.

### 2. Trial de 3 dias

**Migração `supabase/migrations/<ts>_trial_ends_at.sql`:**
```sql
ALTER TABLE tenants ADD COLUMN trial_ends_at timestamptz;
COMMENT ON COLUMN tenants.trial_ends_at IS 'NULL = sem limite (grandfathered/pago). Trial expira quando now() > trial_ends_at.';
```
Tenants existentes ficam NULL (sem UPDATE). O provisionamento de tenant novo — `provisionTenantForUser` em `lib/tenant-provisioning.ts` (insert em `tenants`, chamado por `app/api/auth/callback/route.ts`) — passa a incluir `trial_ends_at` no insert com `new Date(Date.now() + 3*24*60*60*1000).toISOString()`. Testes existentes em `lib/tenant-provisioning.test.ts` são atualizados.

**Gate (server-side):** `getTenantContext()` passa a retornar também `trialExpired: boolean` (calculado de `tenants.trial_ends_at`, sempre `false` para platform admin e para NULL). Pontos de aplicação:
- **Layout do dashboard** (`app/(dashboard)/layout.tsx` ou proxy): `trialExpired` → redirect `/trial-expirado`.
- **Disparo de campanha** (`app/api/campaign/dispatch/route.ts`): `trialExpired` → 403 `{ error: 'trial_expired' }`.
- **Resposta de IA no webhook** (`app/api/webhook/route.ts`, após resolver tenant por phone_number_id): tenant com trial expirado → processa o recebimento (não perde mensagem) mas não dispara IA nem automações.

**`app/trial-expirado/page.tsx` (novo):** tela fora do shell do dashboard — "Seu período de teste terminou", dados preservados, botão de contato (WhatsApp/e-mail do Fernando) e placeholder de "Assinar" que a frente 3 substitui pelo fluxo real.

### 3. Config Supabase (manual, runbook)

- Auth → Providers → Email: **Confirm email ON**; desabilitar OTP/magic link como método de login se opção disponível (senão apenas remoção da UI já basta — sem rota, sem uso).
- Auth → URL Configuration: adicionar `/reset-password` às Redirect URLs de produção.
- SMTP custom (pendência já conhecida) recomendado antes de abrir cadastro público — o rate limit do e-mail embutido agora afeta signup/reset.

## Data Flow

```
Cadastro: /signup → signUp() → e-mail de confirmação → /api/auth/callback (troca code por sessão)
        → primeiro acesso ao app → provisiona tenant com trial_ends_at = now()+3d
Login:   /login → signInWithPassword() → sessão → getTenantContext() → trialExpired?
        → não: app normal | sim: /trial-expirado
Reset:   /forgot-password → e-mail → /reset-password (sessão recovery) → updateUser({password}) → /login
```

## Error Handling

- Login com credencial errada: mensagem genérica "e-mail ou senha inválidos" (não revelar qual).
- Signup com e-mail existente: Supabase retorna sucesso opaco (anti-enumeração) — exibir a mesma mensagem de "confira seu e-mail".
- Gate de trial nunca lança: erro ao ler tenant → trata como sessão inválida → `/login` (falha fechada).
- Webhook: trial expirado não retorna erro à Meta (200 sempre) — só suprime IA/automações.

## Testing

- `lib/tenant-context` (ou helper novo `lib/trial.ts`): `trialExpired` — NULL → false; futuro → false; passado → true; platform admin → false.
- Gate do dispatch: 403 com trial expirado, 200 com trial ativo.
- Webhook: com trial expirado, mensagem é persistida e IA não é chamada (mock).
- Telas: teste mínimo de renderização não é exigido (padrão do repo é testar rotas/lib, não páginas).
- Suíte completa sem regressão sobre 3456 passed / 6 skipped.

## Rollback

Reverter os commits da frente. A coluna `trial_ends_at` pode ficar (inofensiva com NULL). Removida a UI de senha, o magic link volta com o revert (rota e formulário voltam juntos).
