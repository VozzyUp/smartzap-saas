# Cutover Fase 3.2 — Auth por Senha + Trial

Procedimento operacional para o cutover de auth de magic link (Fase 2A/2B) para login por
senha (cadastro + confirmação de e-mail + login/reset por senha), com provisionamento de
trial no signup (Fase 3.2).

Ledger completo (decisões, achados, commits): `.superpowers/sdd/progress.md`
Report de fechamento desta task: `.superpowers/sdd/task-7-report.md`

Este runbook assume que o deploy do código da branch `saas/fase-3-2-auth-senha-trial` (ou a
`main` pós-merge) já ocorreu, e que a migração que adiciona `trial_ends_at` em `tenants`
(Task 1 desta fase) **já foi aplicada** no projeto Supabase de produção — o código lê essa
coluna via `maybeSingle`, então o app não quebra sem ela, mas o trial simplesmente não
funciona até a coluna existir.

---

## Checklist manual pós-deploy

### 1. Config do Supabase Dashboard — Auth → Providers → Email

- [ ] **Confirm email = ON.** Sem isso, contas novas ficariam autenticadas antes de
      confirmar o e-mail, contornando o fluxo de confirmação que o app espera (callback
      provisiona o tenant só após a confirmação).
- [ ] **Minimum password length = 8.** Alinhado com a validação client/server do formulário
      de signup/reset desta fase — evita divergência entre o que a UI permite e o que o
      Supabase aceita.

### 2. Auth → URL Configuration — Redirect URLs

- [ ] Conferir que `https://app.vozzyup.com.br/api/auth/callback` **já está** nas Redirect
      URLs (deveria estar desde o cutover da Fase 2B — ver
      `docs/superpowers/runbooks/2026-07-09-cutover-fase2a-2b.md`, seção 4).
- [ ] **Não é necessário adicionar entrada nova**: o fluxo de reset de senha reusa a mesma
      URL de callback com `?next=/reset-password` (o Supabase troca o `code` do e-mail de
      reset por sessão em `/api/auth/callback`, que redireciona para `/reset-password` em
      vez da home). Confirmar apenas que a URL base segue cadastrada.

### 3. Contas existentes (pré-cutover) — migração via `/forgot-password`

- [ ] Contas criadas antes desta fase (via magic link, sem senha definida) **não têm senha
      no Supabase Auth**. O caminho de acesso para elas é o fluxo de reset:
      `/forgot-password` → e-mail de reset → `/reset-password` (mesma rota de callback,
      `?next=/reset-password`) → definem senha nova.
- [ ] Não é necessário script de backfill/migração de dados — é uma ação do próprio usuário
      na primeira tentativa de login pós-cutover. Comunicar aos usuários existentes (e-mail
      de aviso ou banner no `/login`) que o primeiro acesso após o cutover requer "esqueci
      minha senha".

### 4. Smoke test pós-deploy (fluxo completo)

Executar em sequência contra o ambiente de produção (ou staging equivalente) logo após o
deploy:

- [ ] **Cadastro novo:** `/signup` com um e-mail de teste → confirmar que o e-mail de
      confirmação chega (via SMTP custom configurado, não o SMTP padrão do Supabase, que
      tem rate limit baixo demais para produção).
- [ ] **Confirmar e-mail:** clicar no link do e-mail → confirmar redirect para
      `/api/auth/callback` e depois para a home autenticada, **sem erro**.
- [ ] **Provisionamento de tenant com trial:** conferir no banco que o tenant recém-criado
      tem `trial_ends_at` preenchido (`select tenant_id, trial_ends_at from tenants where
      ...`), consistente com a duração de trial definida no código desta fase.
- [ ] **Login por senha:** logout, depois `/login` com o e-mail e a senha definidos no
      cadastro → sessão válida, acesso à home.
- [ ] **Reset de senha:** `/forgot-password` com o mesmo e-mail → e-mail de reset chega →
      link leva a `/reset-password` → nova senha definida → login com a senha nova funciona
      (e a antiga deixa de funcionar).
- [ ] **Trial expirado bloqueia acesso:** pegar um tenant de teste (não usar produção real)
      e setar `trial_ends_at` manualmente via SQL para uma data no passado:
      ```sql
      update tenants set trial_ends_at = now() - interval '1 day' where id = '<tenant de teste>';
      ```
      Depois:
      - [ ] Acessar o dashboard logado nesse tenant → confirmar redirect para
            `/trial-expirado`.
      - [ ] Disparar uma ação que passe pelo `dispatch` (ex.: enviar campanha/mensagem) →
            confirmar resposta **403**.
      - [ ] Reverter o `trial_ends_at` do tenant de teste ao final (ou descartar o tenant de
            teste) para não deixar lixo em produção.

---

## Verificação da suíte (baseline no momento deste runbook)

- `npx tsc --noEmit` — 0 erros.
- `npx vitest run` — 3470 passed, 6 skipped, 0 fail (126 test files passed, 2 skipped).
- `npm run build` — passa, todas as rotas compiladas (inclui `/login`, `/signup`,
  `/forgot-password`, `/reset-password`, `/trial-expirado`).

## Varredura de resíduos de magic link

`grep -rn "magic-link\|signInWithOtp" app/ lib/ --include="*.ts" --include="*.tsx"` não
retorna nenhuma ocorrência em código executável. Comentários residuais mencionando "magic
link" (herdados da Fase 2A/2B, quando o auth era só magic link) foram corrigidos para
refletir o auth por senha atual em: `app/api/auth/status/route.ts`, `lib/user-auth.ts`,
`proxy.ts`, `app/api/auth/callback/route.ts`, `app/api/auth/logout/route.ts`,
`app/api/auth/setup/route.ts`, `lib/installer/bootstrap.ts`, `lib/user-auth-status.ts`,
`app/api/installer/provision/route.ts`, `app/api/installer/run/route.ts`,
`app/api/installer/run-stream/route.ts`, `app/api/[transport]/route.ts`. Detalhes em
`.superpowers/sdd/task-7-report.md`.
