# Cutover Fase 1 — SmartZap na VPS

Procedimento operacional de migração de infra: deploy do SmartZap SaaS (Next.js 16) para VPS self-hosted (Portainer + Traefik).
Domínio alvo: `app.vozzyup.com.br`

---

## Pré-requisitos

- [ ] Repo `smartzap-saas` criado no GitHub (`VozzyUp/smartzap-saas`); `origin` apontado; branch `saas/fase-1-infra` mergeada em `main`.
- [ ] CI verde: imagem publicada em `ghcr.io/vozzyup/smartzap-saas` (GHCR em **lowercase**). Ambas as tags disponíveis: `latest` e `sha-<short-commit-hash>`.
- [ ] Nome da rede externa do Traefik confirmado na VPS (ex.: `traefik-network`); `CERTRESOLVER` do Traefik confirmado (ex.: `letsencrypt-prod`).
- [ ] Webhook de redeploy do stack criado no Portainer; URL armazenada como secret `PORTAINER_WEBHOOK_URL` no GitHub (para CI auto-redeploy; sem ele, redeploy é manual).

---

## Deploy

### 1. Criar stack no Portainer

- [ ] No Portainer, criar novo stack com `docker-compose.yml` do repositório.
- [ ] Substituir as variáveis de ambiente antes de deploy:
  - `OWNER=vozzyup` (imagem será `ghcr.io/vozzyup/smartzap-saas`)
  - `CERTRESOLVER=<nome confirmado do resolver do Traefik>` (ex.: `letsencrypt-prod`)
  - `TRAEFIK_NETWORK=<nome da rede externa do Traefik>` (ex.: `traefik-network`)

### 2. Pinning de imagem

- [ ] **Recomendação:** pinnar a imagem ao tag específico `sha-<short-commit-hash>` em vez de `latest` para estabilidade em produção. Como `restart: unless-stopped` está configurado, um deploy com `latest` pode causar rollouts inesperados.
  - Forma: editar `docker-compose.yml` no Portainer ou via CLI:
    ```yaml
    services:
      smartzap:
        image: ghcr.io/vozzyup/smartzap-saas:sha-a1b2c3d4  # usar tag específico
    ```

### 3. Variáveis de ambiente (.env)

- [ ] Preencher as variáveis do `.env` no Portainer (ou carregar como secret do Docker) tendo o **`.env.example`** do repositório como fonte da verdade (não redigitar aqui para evitar divergência). Grupos presentes lá:
  - App (`NEXT_PUBLIC_APP_URL`, `APP_ENV`, etc.)
  - Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.)
  - Upstash QStash/Workflow (`QSTASH_TOKEN`, `QSTASH_WORKFLOW_URL`, `UPSTASH_WORKFLOW_URL`, etc.)
  - Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)
  - Auth do produto (`MASTER_PASSWORD`, `SMARTZAP_API_KEY`, `SMARTZAP_ADMIN_KEY`)
  - Meta/WhatsApp (`META_APP_ID`, `META_APP_SECRET`, `META_WABA_ID`, etc.)
  - Push/PWA (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
  - IA (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`)
  - `PORTAINER_WEBHOOK_URL` (se houver auto-redeploy configurado no CI; não faz parte do `.env.example`, é secret do GitHub)

### 4. Subir o stack

- [ ] Deploy do stack no Portainer.
- [ ] Aguardar inicialização dos containers (logs → `smartzap-app` e `smartzap-db`).
- [ ] Validar health check (interno):
  - [ ] Via curl na VPS: `curl -I http://localhost:3000/api/health` → status 200
  - [ ] Confirmar logs sem erros de conexão BD, Redis, OAuth

---

## DNS

- [ ] Criar registro A `app.vozzyup.com.br` → IP da VPS (em seu provedor DNS).
- [ ] Aguardar propagação (~5–30 min, depende do TTL).
- [ ] Revalidar saúde com SSL:
  - [ ] `curl -I https://app.vozzyup.com.br/api/health` → 200 OK, certificado SSL válido (auto-renovado pelo Traefik).
  - [ ] Acessar `https://app.vozzyup.com.br` no navegador; deve carregar UI do app.

---

## Meta / WhatsApp

- [ ] No painel da Meta (Business Manager → Seu App → Messenger/WhatsApp → Configuração):
  - [ ] Atualizar Callback URL do webhook para: `https://app.vozzyup.com.br/api/webhook`
  - [ ] Atualizar Verify Token (deve coincidir com o token configurado — primariamente via setting `webhook_verify_token` no Supabase, com fallback para a env `WEBHOOK_VERIFY_TOKEN`; ver `lib/verify-token.ts`)
  - [ ] Salvar.

- [ ] Revalidar webhook:
  - [ ] No painel Meta, clicar em "Testar Webhook" ou enviar mensagem de teste via WhatsApp.
  - [ ] Confirmar recebimento e assinatura HMAC no inbox/logs do app (verificar `console.log` ou DB de mensagens).
  - [ ] Se falhar: revisar `META_APP_SECRET` no `.env` (usado para calcular o HMAC `x-hub-signature-256` em `app/api/webhook/route.ts`).

---

## QStash

- [ ] Confirmar URLs de workflow no `.env` (ver `.env.example`):
  - [ ] `QSTASH_WORKFLOW_URL` = `https://app.vozzyup.com.br` (domínio raiz, sem path)
  - [ ] `UPSTASH_WORKFLOW_URL` = `https://app.vozzyup.com.br` (domínio raiz, sem path)
  
- [ ] Disparar 1 campanha de teste (apenas alguns contatos):
  - [ ] Selecionar contatos de teste no app; criar fluxo simples; agendar disparo.
  - [ ] Aguardar execução e validar:
    - [ ] Logs do QStash mostram callback recebido em `app.vozzyup.com.br`.
    - [ ] Mensagens chegam aos contatos de teste.
    - [ ] DB registra status de entrega corretamente.

---

## PWA

- [ ] Notificações push antigas (antes do cutover) estão atreladas à origem antiga (`smartzap-eta.vercel.app`); novos devices/navegadores devem re-subscrever.
  - [ ] Acessar `https://app.vozzyup.com.br` em um navegador com PWA habilitado.
  - [ ] Confirmar prompt de permissão de notificações.
  - [ ] Re-subscrever o device/navegador.

- [ ] Enviar 1 notificação de teste:
  - [ ] Via app ou painel interno, disparar notificação push.
  - [ ] Confirmar recebimento no device subscrito.
  - [ ] Validar logs do servidor (sem erros de push).

---

## Validação Final

- [ ] **Fluxo completo de negócio:**
  - [ ] Login com credenciais válidas → inbox aberto e realtime (WebSocket).
  - [ ] Criar 1 fluxo com nó `ai_agent` (se aplicável) → testar chamada à API e resposta.
  - [ ] Disparar 1 campanha simples → confirmar entrega e logs.

- [ ] **Atualizar scripts internos de operações:**
  - [ ] Buscar e substituir referências de `smartzap-eta.vercel.app` → `app.vozzyup.com.br` em:
    - Scripts de CI/CD (se houver)
    - Dashboards de monitoramento
    - Runbooks/docs internos
    - Configurações de alertas (Sentry, Datadog, etc.)

- [ ] **Verificação de performance (opcional mas recomendado):**
  - [ ] Comparar tempos de resposta de `/api/health` entre staging e produção.
  - [ ] Confirmar que taxa de erro é < 0.1% (monitorar durante 30 min).
  - [ ] Validar memória e CPU no Portainer (não devem estar saturados).

---

## Rollback

Se algo der errado durante validação:

1. No Portainer: Parar o stack (não remover) e reativar o DNS/load balancer para staging anterior (se disponível).
2. Revisar logs do container e variáveis de ambiente.
3. Corrigir a issue (ex.: `.env` faltando, rede Traefik errada) e tentar novamente.
4. **Não fazer rollback de tráfego até validação completa da seção de validação final.**

---

## Notas

- **GHCR lowercase:** Docker registries distinguem maiúsculas e minúsculas. O CI publica em `ghcr.io/vozzyup/smartzap-saas` (lowercase). No `docker-compose.yml`, sempre usar `OWNER=vozzyup`.
- **Short-SHA pinning:** Garante que redeploys acidentais via `latest` não causem rollouts inesperados. Usar `git rev-parse --short HEAD` para obter o short-SHA.
- **Auto-redeploy:** Se `PORTAINER_WEBHOOK_URL` estiver configurado como secret no GitHub, o CI enviará webhook ao Portainer após novo push; caso contrário, fazer redeploy manual no painel.
- **Certificados SSL:** Traefik com `certresolver` configurado auto-renova certificados Let's Encrypt. Monitorar logs para erros de renovação.
