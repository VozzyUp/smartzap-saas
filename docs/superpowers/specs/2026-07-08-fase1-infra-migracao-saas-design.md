# Fase 1 — Migração de Infraestrutura (Vercel → VPS própria)

**Data:** 2026-07-08
**Produto:** SmartZap SaaS (`smartzap-saas`), clonado de `frazevedo10/vsmart` (histórico preservado; base do produto agora em `upstream`)
**Status:** Design aprovado — pronto para virar plano de implementação

---

## Contexto

O SmartZap é hoje um SaaS **single-tenant** de automação de WhatsApp com IA (Next.js 16 / App Router, React 19, Supabase, Upstash QStash, Meta WhatsApp Cloud API v24.0, Vercel AI SDK v6), hospedado na **Vercel**.

O objetivo maior é transformá-lo em um **SaaS multi-tenant** de verdade, hospedado em infraestrutura própria. Esse objetivo foi decomposto em 4 sub-projetos independentes, cada um com seu próprio ciclo de spec → plano → implementação:

| Fase | Sub-projeto | Entrega |
|---|---|---|
| **1** | **Migração de infra** (este spec) | App na VPS própria, domínio próprio, SSL, filas funcionando fora da Vercel |
| 2 | Fundação multi-tenant | Contas/orgs, isolamento de dados (RLS), onboarding, fim do `MASTER_PASSWORD` |
| 3 | Onboarding WhatsApp por tenant | Método manual + Embedded Signup/Coexistence (fluxo de Tech Provider) |
| 4 | Billing e limites | Planos, cobrança, limites por tenant |

**A ordem importa:** a infra restringe o desenho do multi-tenancy. Por isso migramos a hospedagem **primeiro**, sem tocar na arquitetura de aplicação.

### Motivação da migração

Sair da Vercel por **controle e domínio próprio** — o app deve rodar na VPS do usuário, sob o domínio dele. **Não** é objetivo eliminar todo serviço gerenciado: Supabase Cloud e Upstash (QStash/Redis) permanecem, pois funcionam de qualquer host e não tiram o controle da aplicação.

---

## Objetivos da Fase 1

1. O SmartZap roda em container Docker na VPS do usuário (que já tem Portainer + Traefik), acessível em `https://app.vozzyup.com.br` com SSL válido.
2. As filas (QStash/Upstash Workflow) continuam funcionando: o QStash chama de volta os endpoints públicos no novo domínio.
3. Webhooks da Meta (WhatsApp) chegam ao novo domínio.
4. Pipeline de deploy reproduzível: push → imagem publicada → Portainer atualiza o container.
5. Nenhuma regressão funcional no core: login, inbox em tempo real, disparo de campanha, execução de fluxo com IA, notificações push.

## Não-objetivos (fora do escopo desta fase)

- Multi-tenancy, contas de usuário, RLS (Fase 2).
- Embedded Signup / Coexistence (Fase 3).
- Billing (Fase 4).
- Self-hostar Supabase ou trocar QStash por fila própria (BullMQ) — otimização futura, opcional.
- Reimplementar as features de ops atadas à Vercel (redeploy, uso/billing, gestão de domínio) — nesta fase ficam **desativadas/ocultas**.

---

## Decisões travadas

| Decisão | Escolha | Racional |
|---|---|---|
| Cenário de hosting | **A — Migração leve** | Manter Supabase Cloud + QStash; só muda onde o app roda. Menor risco, sem reescrever o engine de filas durante a migração. |
| Onde roda | **VPS própria via Portainer (Docker)** | Ambiente já existente do usuário; Docker é o meio natural. |
| Banco/Auth/Realtime/Storage | **Supabase Cloud** (mantém) | Auth + RLS + Realtime serão base do multi-tenancy (Fase 2). |
| Filas | **Upstash QStash / Workflow** (mantém) | Fornece durable steps ao workflow engine; funciona da VPS via callback HTTP público. |
| Reverse proxy | **Traefik** (já existente na VPS) | Integração via labels no compose; SSL Let's Encrypt já gerenciado pelo Traefik. |
| Domínio | **`app.vozzyup.com.br`** | Domínio próprio do usuário. |
| CI/CD | **GitHub Actions → GHCR → Portainer (webhook)** | Reproduzível; não gasta CPU/RAM da VPS no build; Portainer só faz `pull` da imagem pronta. |
| Features de ops Vercel | **Desativar/ocultar** | São conveniências de admin; reimplementação (Portainer) fica para depois, se necessário. |

---

## Arquitetura alvo

```
                 app.vozzyup.com.br   (DNS A → IP da VPS)
                         │  :443 (TLS)
                         ▼
        ┌────────────────────────────────────────┐
        │  Traefik (já rodando)                   │  SSL Let's Encrypt automático
        │  router: Host(`app.vozzyup.com.br`)     │  roteia p/ service interno :3000
        └────────────────────────────────────────┘
                         │  rede Docker interna
                         ▼
        ┌────────────────────────────────────────┐
        │  Container: smartzap (Next standalone)  │  node server.js
        │  healthcheck → GET /api/health          │
        └────────────────────────────────────────┘
              │              │               │
              ▼              ▼               ▼
        Supabase Cloud   Upstash QStash   Upstash Redis
        (Postgres,       (filas; chama    (cache de
         Auth, Realtime,  de volta o        credenciais,
         Storage)         domínio público)  rate-limit)

        Gerenciado como um stack no Portainer.
```

O app é a única peça que muda de casa. Supabase e Upstash continuam externos e são acessados por rede (chaves via env).

---

## Estado atual (auditoria do acoplamento com a Vercel)

A auditoria do `frazevedo10/vsmart` (HEAD `17c69e2`) mostrou que o código **já está muito preparado** para self-host:

**Já pronto:**
- `next.config.ts` já tem `output: 'standalone'` (comentário literal *"Standalone output for Docker"*).
- `NEXT_PUBLIC_APP_URL` já é o **override principal** da URL pública. Padrão recorrente no código:
  `NEXT_PUBLIC_APP_URL || VERCEL_PROJECT_PRODUCTION_URL || VERCEL_URL || 'http://localhost:3000'`
  (ex.: `lib/builder/workflow-schedule.ts:40`, `app/api/campaign/dispatch/route.ts`, `app/api/campaign/workflow/route.ts`, `app/api/meta/webhooks/subscription/route.ts`, `app/api/flows/endpoint/keys/route.ts`).
- `/api/health` existe (healthcheck de container e do Traefik).
- `proxy.ts` é o middleware do Next 16 (auth) — roda no server standalone, sem mudança.
- Headers de segurança estão em `next.config.ts headers()` — **duplicados** no `vercel.json`, que fica redundante.

**Acoplamento a tratar, por categoria:**

| Categoria | Onde | Ação nesta fase |
|---|---|---|
| Construção de URL base (~20 arquivos) | Usam `NEXT_PUBLIC_APP_URL \|\| VERCEL_*` | Resolvido por env (`NEXT_PUBLIC_APP_URL`). **Auditar** os que usam só `VERCEL_URL` sem o fallback (ex.: `lib/mcp/tools/*.ts`, `lib/inbox/inbox-webhook.ts:346`, `app/api/settings/all/route.ts:273`) e adicionar `NEXT_PUBLIC_APP_URL` como primeira opção. |
| `VERCEL_ENV` (detecção prod/preview) | Vários (`lib/supabase.ts`, `health-check`, `dynamic-flow`, rotas meta/campaign) | Introduzir `APP_ENV` (fallback para `NODE_ENV`); substituir leituras de `VERCEL_ENV`. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `lib/inbox/inbox-webhook.ts`, `app/api/webhook/route.ts`, `app/api/campaign/dispatch/route.ts` | Vira no-op (VPS não tem deployment protection). |
| `VERCEL_GIT_COMMIT_SHA` (versão) | `next.config.ts`, `webhook/info` | Injetar SHA via build-arg do Docker → `APP_VERSION`. |
| API de plataforma Vercel | `lib/vercel-api.ts`, `app/api/vercel/*` (info, redeploy, deploy-status), `app/api/usage` (billing Vercel), `app/api/settings/domains`, `app/api/system` (tokens Vercel), `app/api/auth/status` (VERCEL_TOKEN) | **Desativar/ocultar**: endpoints retornam `501/"não aplicável"` de forma graciosa; esconder os elementos de UI que os consomem. |
| AI Gateway da Vercel (opcional) | `lib/builder/ai-gateway/*`, `app/api/builder/ai-gateway/*`, `components/**/AIGatewayPanel.tsx`, `lib/builder/auth.ts` (VERCEL_CLIENT_ID/SECRET), `lib/ai/embeddings.ts` (VERCEL_OIDC_TOKEN) | Feature **opcional** de BYOK. Mantém desativada (`AI_GATEWAY_MANAGED_KEYS_ENABLED` off); IA roda direto com chave do provider. Ocultar o painel para não exibir links quebrados. |
| Scripts de ops com URL hardcoded | `package.json` (`logs:follow:prod`, `monitor:all`, `test:stress:prod`) e `scripts/*` apontam para `smartzap-eta.vercel.app` | Atualizar para `app.vozzyup.com.br`. Não-runtime. |

Nenhum item é bloqueante para o core (campanhas, inbox, IA, workflows).

---

## Trabalho da Fase 1 (entregáveis)

### 1. Dockerfile (multi-stage)
- **Stage build:** `node:22-alpine`, `npm ci`, `npm run build` (gera `.next/standalone`).
- **Stage runner:** copia `.next/standalone`, `.next/static`, `public/`, **e `supabase/migrations/**`** (exigido pelo `outputFileTracingIncludes` de `/api/installer/run-stream`).
- `CMD ["node", "server.js"]`, expõe `:3000`, roda como usuário não-root.
- `ARG APP_VERSION` recebido no build (SHA do git) → env em runtime.

### 2. Stack do Portainer (docker-compose)
- Service `smartzap` conectado à rede externa do Traefik.
- **Labels do Traefik:**
  - `traefik.enable=true`
  - `traefik.http.routers.smartzap.rule=Host(\`app.vozzyup.com.br\`)`
  - `traefik.http.routers.smartzap.entrypoints=websecure`
  - `traefik.http.routers.smartzap.tls.certresolver=<resolver-existente>`
  - `traefik.http.services.smartzap.loadbalancer.server.port=3000`
- **Healthcheck:** `GET /api/health`.
- Env via arquivo/secret do Portainer (ver seção Env vars).
- Política de restart `unless-stopped`.

### 3. Estratégia de variáveis de ambiente
Migrar todas as envs da Vercel para o Portainer. Criar `.env.example` documentando cada uma. Grupos (nomes confirmados na auditoria):

- **App:** `NEXT_PUBLIC_APP_URL=https://app.vozzyup.com.br`, `APP_ENV=production`, `APP_VERSION` (build-arg).
- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`.
- **QStash / Workflow:** `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_WORKFLOW_URL` / `UPSTASH_WORKFLOW_URL` → apontar para `https://app.vozzyup.com.br/...`.
- **Upstash Redis:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- **Auth do produto:** `MASTER_PASSWORD`, `SMARTZAP_API_KEY`, `SMARTZAP_ADMIN_KEY`.
- **Meta/WhatsApp:** `META_APP_ID`, `META_APP_SECRET`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_GRAPH_VERSION` (e/ou os `WHATSAPP_*` correspondentes — muitos são só tunables opcionais). Obs: credenciais primárias vêm da tabela `settings` do Supabase; env é fallback.
- **Push (PWA):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- **IA (conforme uso):** `OPENAI_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`, etc. — ou configuradas pelo usuário na UI.
- **Manter desligado:** `AI_GATEWAY_MANAGED_KEYS_ENABLED` (não setar / `false`).

### 4. Correção da construção de URL base
Garantir que **todo** ponto que monta URL pública prefira `NEXT_PUBLIC_APP_URL`. Padronizar num helper único (ex.: `lib/app-url.ts` com `getAppUrl()`) e refatorar os call-sites que hoje leem `VERCEL_URL` diretamente sem fallback. Cobrir: dispatch de campanha, callback de workflow, webhook subscription, flows endpoints, forms/actions, inbox-webhook, MCP tools.

### 5. Decoupling da Vercel (limpeza)
- Deletar `vercel.json` e `.vercelignore` (headers já em `next.config.ts`).
- Remover do `next.config.ts` o bloco de env dependente de `VERCEL_GIT_*`; derivar versão de `APP_VERSION`.
- Stubar `/api/vercel/*`, `/api/usage` (parte Vercel), `/api/settings/domains`, e leituras de `VERCEL_TOKEN` em `system`/`auth/status` para degradar graciosamente.
- Ocultar na UI: botão de redeploy, painel de uso/billing Vercel, `AIGatewayPanel`/consent overlay.
- `VERCEL_AUTOMATION_BYPASS_SECRET` → no-op.
- Atualizar scripts que hardcodam `smartzap-eta.vercel.app`.

### 6. CI/CD — GitHub Actions → GHCR → Portainer
- Workflow em `.github/workflows/deploy.yml`: no push para `main`, build da imagem Docker (passando `APP_VERSION=${{ github.sha }}`), push para `ghcr.io/<owner>/smartzap-saas:latest` + tag do SHA.
- Portainer configurado para **redeploy via webhook** (ou Watchtower) puxando a nova imagem.
- Secrets no GitHub: credenciais do GHCR (ou `GITHUB_TOKEN`), URL do webhook do Portainer.

### 7. Plano de cutover
1. Criar o repositório no GitHub e definir como `origin` (ainda pendente — ver Pendências).
2. Provisionar as envs no Portainer.
3. Subir o stack; validar em `https://app.vozzyup.com.br` com SSL.
4. Apontar DNS `A` de `app.vozzyup.com.br` para o IP da VPS.
5. Reconfigurar na Meta a **Callback URL** do webhook do WhatsApp para `https://app.vozzyup.com.br/api/webhook` (revalidar `verify_token`/HMAC).
6. Ajustar base URL do QStash/Workflow para o novo domínio.
7. PWA: usuários re-assinam push (subscriptions antigas são atreladas à origem antiga).

### 8. Verificação (feito quando…)
- `GET /api/health` responde OK atrás do Traefik com SSL válido.
- Login no dashboard funciona (sessão/cookie).
- Webhook de teste da Meta é recebido e processado.
- **Disparo de 1 campanha real de teste** conclui — valida o callback do QStash chegando ao novo domínio (o teste mais importante).
- 1 fluxo com nó `ai_agent` executa e responde.
- Realtime (inbox) atualiza ao vivo.
- Build de CI publica imagem e Portainer atualiza o container.

---

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Algum call-site de URL usa só `VERCEL_URL` sem fallback → callback do QStash/webhook quebra | Alto | Item 4: centralizar em `getAppUrl()` e auditar todos os call-sites; teste de campanha valida ponta a ponta. |
| `supabase/migrations/**` não vai para a imagem standalone → installer quebra | Médio | Copiar explicitamente no Dockerfile; testar `/api/installer` na imagem. |
| Config do Traefik (certresolver/entrypoint) diverge da já existente | Médio | Confirmar nomes do resolver/entrypoints do Traefik atual antes do deploy. |
| Env faltante em runtime (Supabase/QStash retornam `null` silenciosamente) | Médio | `.env.example` completo + checagem no `/api/health` para envs críticas. |
| Assinatura/verify token do webhook Meta desalinhado após troca de domínio | Médio | Revalidar no cutover (passo 5) antes de considerar concluído. |

---

## Pendências / premissas a confirmar na implementação

- **Repo no GitHub:** `origin` ainda não definido (`gh` CLI ausente no ambiente). O usuário cria o repositório `smartzap-saas` no GitHub e fornece a URL, ou instala o `gh` para automatizar. Enquanto isso, commits ficam locais.
- **Traefik:** confirmar o nome do `certresolver` e do `entrypoint` (websecure) já usados na VPS.
- **Portainer:** confirmar mecanismo de atualização preferido (webhook de stack vs. Watchtower).
- **Versão do Node:** assumido `node:22` (LTS) para a imagem; confirmar compatibilidade com Next 16.
- **QStash local/dev:** o fluxo de dev usa túnel (`scripts/dev-with-tunnel.mjs`); não afeta produção, mas documentar.

---

## Próximo passo

Após revisão e aprovação deste spec, seguir para a skill **writing-plans** e produzir o plano de implementação detalhado da Fase 1.
