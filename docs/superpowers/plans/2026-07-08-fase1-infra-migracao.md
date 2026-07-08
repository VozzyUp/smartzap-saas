# Fase 1 — Migração de Infra (Vercel → VPS própria) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o SmartZap rodar em container Docker na VPS própria do usuário (Portainer + Traefik) em `https://app.vozzyup.com.br`, com filas (QStash) e webhooks funcionando, sem depender da Vercel.

**Architecture:** Cenário A (migração leve): o app Next.js (já em `output: 'standalone'`) é empacotado em Docker e servido atrás do Traefik existente; Supabase Cloud e Upstash (QStash/Redis) permanecem externos. O acoplamento com a Vercel é removido ou neutralizado, centralizando a derivação de URL pública num único helper e trocando `VERCEL_ENV` por `APP_ENV`. Deploy via GitHub Actions → GHCR → Portainer.

**Tech Stack:** Next.js 16 (App Router, standalone), React 19, TypeScript, Supabase, Upstash QStash/Redis, Docker, Traefik, Portainer, GitHub Actions, Vitest.

## Global Constraints

- Node runtime da imagem: **Node 22 (LTS)** — `node:22-alpine`.
- Domínio de produção: **`https://app.vozzyup.com.br`** (valor de `NEXT_PUBLIC_APP_URL`).
- Testes unitários: **Vitest** com `globals: true` e alias `@` → raiz do repo. Arquivos `*.test.ts`.
- Comandos: `npm run test` (vitest run), `npm run build`, `npm run lint`.
- Não introduzir multi-tenancy, billing ou mudanças de auth — fora do escopo desta fase.
- Manter Supabase Cloud + QStash; **não** trocar o engine de filas.
- Features de ops da Vercel: **desativar/ocultar**, não remover funcionalidade de produto.
- Branch de trabalho: `saas/fase-1-infra`. Commits frequentes, um por passo de commit.
- Spec de referência: `docs/superpowers/specs/2026-07-08-fase1-infra-migracao-saas-design.md`.

---

## Estrutura de arquivos

**Criar:**
- `lib/app-url.ts` — helper único `getAppUrl()` para derivar a URL pública.
- `lib/app-url.test.ts` — testes do helper.
- `lib/app-env.ts` — helper `getAppEnv()` / `isProduction()` substituindo `VERCEL_ENV`.
- `lib/app-env.test.ts` — testes do helper.
- `Dockerfile` — build multi-stage da imagem standalone.
- `.dockerignore` — reduz contexto de build.
- `docker-compose.yml` — stack do Portainer com labels do Traefik.
- `.env.example` — documenta todas as env vars.
- `.github/workflows/deploy.yml` — CI build → GHCR.
- `docs/superpowers/runbooks/2026-07-08-cutover-fase1.md` — runbook de cutover.

**Modificar:**
- Call-sites de URL (Task 2): `lib/builder/workflow-schedule.ts`, `lib/inbox/inbox-webhook.ts`, `lib/mcp/tools/*.ts`, `app/api/campaign/dispatch/route.ts`, `app/api/campaign/workflow/route.ts`, `app/api/campaigns/route.ts`, `app/api/campaigns/[id]/resend-skipped/route.ts`, `app/api/meta/webhooks/subscription/route.ts`, `app/api/flows/endpoint/keys/route.ts`, `app/api/flows/endpoint/test/route.ts`, `app/api/flows/[id]/meta/publish/route.ts`, `app/api/settings/all/route.ts`, `app/(dashboard)/forms/actions.ts`, `lib/whatsapp-status-events.ts`, `lib/google-calendar.ts`, `app/api/meta/diagnostics/route.ts`.
- Call-sites de `VERCEL_ENV` (Task 3): `lib/supabase.ts`, `lib/health-check.ts`, `lib/dynamic-flow.ts`, e os já tocados na Task 2 que leem `VERCEL_ENV`.
- `next.config.ts` — remover bloco `env` dependente de `VERCEL_GIT_*`; usar `APP_VERSION` (Task 4).
- `app/api/vercel/*/route.ts`, `app/api/usage/route.ts`, `app/api/settings/domains/route.ts` — stub (Task 5).
- `components/features/settings/AIGatewayPanel.tsx` e consumidores dos endpoints de ops — ocultar na UI (Task 5).

**Deletar:**
- `vercel.json`, `.vercelignore` (Task 4).

---

### Task 1: Helper único de URL pública (`lib/app-url.ts`)

Centraliza a lógica hoje espalhada. Prefere `NEXT_PUBLIC_APP_URL`; aceita um `fallbackOrigin` opcional (para rotas que querem o origin do request quando a env não está setada); por fim `http://localhost:3000`. Remove ramos de `VERCEL_*`.

**Files:**
- Create: `lib/app-url.ts`
- Test: `lib/app-url.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `getAppUrl(fallbackOrigin?: string | null): string` — retorna URL absoluta **sem** barra final.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// lib/app-url.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAppUrl } from '@/lib/app-url'

describe('getAppUrl', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL
  beforeEach(() => { delete process.env.NEXT_PUBLIC_APP_URL })
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = original
  })

  it('usa NEXT_PUBLIC_APP_URL quando definida', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vozzyup.com.br'
    expect(getAppUrl()).toBe('https://app.vozzyup.com.br')
  })

  it('remove barra final', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vozzyup.com.br/'
    expect(getAppUrl()).toBe('https://app.vozzyup.com.br')
  })

  it('usa o fallbackOrigin quando a env não está setada', () => {
    expect(getAppUrl('https://tunnel.example.com')).toBe('https://tunnel.example.com')
  })

  it('prioriza a env sobre o fallbackOrigin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vozzyup.com.br'
    expect(getAppUrl('https://tunnel.example.com')).toBe('https://app.vozzyup.com.br')
  })

  it('cai para localhost quando nada está definido', () => {
    expect(getAppUrl()).toBe('http://localhost:3000')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run lib/app-url.test.ts`
Expected: FAIL — `Cannot find module '@/lib/app-url'`.

- [ ] **Step 3: Implementar o helper**

```typescript
// lib/app-url.ts
/**
 * URL pública da aplicação, usada para montar callbacks (QStash), webhooks
 * e links absolutos. Fonte única de verdade — substitui a antiga cadeia de
 * fallbacks com variáveis VERCEL_*.
 *
 * @param fallbackOrigin origin do request (ex.: `new URL(req.url).origin`),
 *   usado apenas quando NEXT_PUBLIC_APP_URL não está setada.
 */
export function getAppUrl(fallbackOrigin?: string | null): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  if (fallbackOrigin) return fallbackOrigin.trim().replace(/\/+$/, '')
  return 'http://localhost:3000'
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run lib/app-url.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/app-url.ts lib/app-url.test.ts
git commit -m "feat(infra): helper único getAppUrl() para URL pública"
```

---

### Task 2: Migrar call-sites de URL para `getAppUrl()`

Refatoração mecânica: cada arquivo que hoje monta `baseUrl` com a cadeia `NEXT_PUBLIC_APP_URL || VERCEL_* || localhost` passa a chamar `getAppUrl()`. Onde existe origin do request (ex.: `campaign/dispatch`), passar como `fallbackOrigin`.

**Files:** (Modify — lista completa)
- `lib/builder/workflow-schedule.ts:40-43`
- `lib/inbox/inbox-webhook.ts:342-348`
- `lib/mcp/tools/system.ts:8`, `lib/mcp/tools/settings.ts:5`, `lib/mcp/tools/messages.ts:5`, `lib/mcp/tools/inbox.ts:7`, `lib/mcp/tools/flows.ts:5`, `lib/mcp/tools/contacts-write.ts:5`, `lib/mcp/tools/campaigns.ts:9`, `lib/mcp/tools/campaigns-write.ts:5`, `lib/mcp/tools/agents.ts:6`, `lib/mcp/tools/templates.ts:83`
- `app/api/campaign/dispatch/route.ts:947-966`
- `app/api/campaign/workflow/route.ts:2589-2594`
- `app/api/campaigns/route.ts:146-151`
- `app/api/campaigns/[id]/resend-skipped/route.ts:645-647`
- `app/api/meta/webhooks/subscription/route.ts:14-19`
- `app/api/flows/endpoint/keys/route.ts:56-61`
- `app/api/flows/endpoint/test/route.ts:9-13`
- `app/api/flows/[id]/meta/publish/route.ts:70-73`
- `app/api/settings/all/route.ts:272-273`
- `app/(dashboard)/forms/actions.ts:40-41`
- `lib/whatsapp-status-events.ts:45-46`
- `lib/google-calendar.ts:66-71`
- `app/api/meta/diagnostics/route.ts:288-291,750-751,1453-1454`

**Interfaces:**
- Consumes: `getAppUrl(fallbackOrigin?)` da Task 1.
- Produces: nenhuma nova assinatura pública; comportamento preservado.

- [ ] **Step 1: Localizar todos os call-sites**

Run: `git grep -nE "VERCEL_PROJECT_PRODUCTION_URL|VERCEL_URL" -- 'lib/**' 'app/**' | grep -v "vercel/\|usage/\|settings/domains\|health/route\|webhook/info\|/system/route\|auth/status"`
Expected: lista batendo com os arquivos acima (os excluídos são tratados nas Tasks 4/5).

- [ ] **Step 2: Padrão simples — substituir a cadeia por `getAppUrl()`**

Para os arquivos com a cadeia pura (ex.: `lib/builder/workflow-schedule.ts`, `lib/inbox/inbox-webhook.ts`, todos os `lib/mcp/tools/*.ts`, `flows/*`, `campaigns/route.ts`, `resend-skipped`, `meta/webhooks/subscription`, `settings/all`, `whatsapp-status-events`, `google-calendar`, `forms/actions`, `campaign/workflow`), adicionar o import e trocar o bloco.

Import no topo do arquivo:
```typescript
import { getAppUrl } from '@/lib/app-url'
```

Exemplo — `lib/builder/workflow-schedule.ts` (antes → depois):
```typescript
// ANTES (linhas 40-43)
const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
  || "http://localhost:3000";

// DEPOIS
const baseUrl = getAppUrl();
```

Exemplo — `lib/mcp/tools/system.ts:8` (função inline):
```typescript
// ANTES
const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
// DEPOIS
const baseUrl = () => getAppUrl()
```

- [ ] **Step 3: Padrão com request origin — `app/api/campaign/dispatch/route.ts`**

Este arquivo escolhe entre origin do request e URL de produção via `VERCEL_ENV`. Em VPS single-deploy não há "outro deployment": preferir a env explícita e usar o origin do request só como fallback.

```typescript
// ANTES (linhas ~947-966): bloco com explicitAppUrl, vercelEnv, productionUrl, vercelUrl, regra de ouro...
// DEPOIS
const requestOrigin = getRequestOrigin(request)
const baseUrl = getAppUrl(requestOrigin)
const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')
```
Manter as linhas de `console.log` de debug logo abaixo, ajustando o objeto logado para `{ baseUrl, hasRequestOrigin: Boolean(requestOrigin) }` (remover referências a `vercelEnv`, `productionUrl`, `vercelUrl`). Manter o import existente de `getRequestOrigin`.

- [ ] **Step 4: `app/api/meta/diagnostics/route.ts`**

Trocar cada uma das três construções de `baseUrl` (linhas ~288-291, ~750-751, ~1453-1454) por `getAppUrl()` e adicionar o import. Este arquivo é de diagnóstico; a URL só é exibida/testada, então `getAppUrl()` sem fallback é suficiente.

- [ ] **Step 5: Verificar que não sobraram cadeias de URL fora dos buckets de ops**

Run: `git grep -nE "VERCEL_(PROJECT_PRODUCTION_URL|URL)" -- 'lib/**' 'app/**' | grep -v "vercel/\|usage/\|settings/domains\|health/route\|webhook/info\|/system/route\|auth/status"`
Expected: sem resultados (vazio).

- [ ] **Step 6: Type-check e lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

- [ ] **Step 7: Rodar a suíte de testes afetada**

Run: `npx vitest run lib/ app/api/`
Expected: PASS (nenhuma regressão; testes existentes que mockam essas envs continuam válidos pois `getAppUrl` respeita `NEXT_PUBLIC_APP_URL`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(infra): centralizar derivação de URL pública em getAppUrl()"
```

---

### Task 3: Helper `APP_ENV` e substituição de `VERCEL_ENV`

**Files:**
- Create: `lib/app-env.ts`, `lib/app-env.test.ts`
- Modify: `lib/supabase.ts:52`, `lib/health-check.ts:81`, `lib/dynamic-flow.ts:404`, `app/api/campaigns/route.ts:147`, `app/api/meta/webhooks/subscription/route.ts:14`, `app/api/meta/diagnostics/route.ts:286`, `app/api/campaign/workflow/route.ts:2589`, `app/api/campaign/dispatch/route.ts:1004`, `lib/google-calendar.ts:66`

**Interfaces:**
- Consumes: nada.
- Produces: `getAppEnv(): 'production' | 'development'` e `isProduction(): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// lib/app-env.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { getAppEnv, isProduction } from '@/lib/app-env'

describe('getAppEnv', () => {
  const orig = process.env.APP_ENV
  afterEach(() => {
    if (orig === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = orig
  })

  it('usa APP_ENV quando definida', () => {
    process.env.APP_ENV = 'production'
    expect(getAppEnv()).toBe('production')
    expect(isProduction()).toBe(true)
  })

  it('cai para NODE_ENV quando APP_ENV ausente', () => {
    delete process.env.APP_ENV
    // NODE_ENV em teste normalmente é 'test' → tratado como não-produção
    expect(isProduction()).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/app-env.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
// lib/app-env.ts
/**
 * Ambiente lógico da aplicação. Substitui process.env.VERCEL_ENV.
 * Prioridade: APP_ENV → NODE_ENV. Qualquer valor != 'production' é não-produção.
 */
export function getAppEnv(): 'production' | 'development' {
  const raw = (process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase()
  return raw === 'production' ? 'production' : 'development'
}

export function isProduction(): boolean {
  return getAppEnv() === 'production'
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/app-env.test.ts`
Expected: PASS.

- [ ] **Step 5: Substituir leituras de `VERCEL_ENV`**

Em cada arquivo listado, trocar comparações `process.env.VERCEL_ENV === 'production'` por `isProduction()` e `process.env.VERCEL_ENV` (quando usado como string de ambiente) por `getAppEnv()`, adicionando `import { getAppEnv, isProduction } from '@/lib/app-env'`. Onde a lógica ramificava em `preview` (ex.: `campaign/dispatch`), tratar `preview` como não-produção (já coberto pela Task 2, que removeu o ramo).

Run após editar: `git grep -n "VERCEL_ENV" -- 'lib/**' 'app/**'`
Expected: apenas ocorrências dentro dos endpoints de ops (Task 5), se houver; nenhuma no core.

- [ ] **Step 6: Type-check, lint e testes**

Run: `npx tsc --noEmit && npm run lint && npx vitest run lib/ app/api/`
Expected: sem erros; PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(infra): substituir VERCEL_ENV por helper APP_ENV"
```

---

### Task 4: Remover acoplamento de plataforma no build (`next.config.ts`, `vercel.json`)

**Files:**
- Modify: `next.config.ts:59-65` (bloco `env`)
- Delete: `vercel.json`, `.vercelignore`

**Interfaces:**
- Consumes: nada.
- Produces: env `NEXT_PUBLIC_APP_VERSION` derivada de `APP_VERSION` (build-arg).

- [ ] **Step 1: Ajustar o bloco `env` do `next.config.ts`**

```typescript
// ANTES
env: {
  NEXT_PUBLIC_APP_NAME: 'SmartZap',
  NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || '1.0.0',
  NEXT_PUBLIC_VERCEL_TEAM: process.env.VERCEL_GIT_REPO_OWNER ?? '',
  NEXT_PUBLIC_VERCEL_PROJECT: process.env.VERCEL_GIT_REPO_SLUG ?? '',
},

// DEPOIS
env: {
  NEXT_PUBLIC_APP_NAME: 'SmartZap',
  NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION?.substring(0, 7) || '1.0.0',
},
```

Se houver referências a `NEXT_PUBLIC_VERCEL_TEAM` / `NEXT_PUBLIC_VERCEL_PROJECT` no código do AI Gateway, elas serão neutralizadas na Task 5 (painel oculto). Confirmar:
Run: `git grep -n "NEXT_PUBLIC_VERCEL_TEAM\|NEXT_PUBLIC_VERCEL_PROJECT"`
Se aparecer fora do AI Gateway, ajustar para string vazia inline.

- [ ] **Step 2: Deletar arquivos redundantes da Vercel**

```bash
git rm vercel.json .vercelignore
```
Os headers de segurança já existem em `next.config.ts` `headers()` — sem perda.

- [ ] **Step 3: Build para validar**

Run: `npm run build`
Expected: build conclui; `.next/standalone/server.js` gerado.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(infra): remover vercel.json/.vercelignore e usar APP_VERSION no build"
```

---

### Task 5: Desativar/ocultar features de ops atadas à Vercel

Endpoints de ops passam a degradar graciosamente (HTTP 501 + mensagem) e a UI que os consome fica oculta. Sem remover funcionalidade de produto.

**Files:**
- Modify: `app/api/vercel/redeploy/route.ts`, `app/api/vercel/info/route.ts`, `app/api/vercel/deploy-status/route.ts`, `app/api/usage/route.ts` (trecho Vercel), `app/api/settings/domains/route.ts`
- Modify (no-op do bypass): `lib/inbox/inbox-webhook.ts:367`, `app/api/webhook/route.ts:1021`, `app/api/campaign/dispatch/route.ts:1039`
- Modify (UI): `components/features/settings/AIGatewayPanel.tsx` e componente que renderiza o botão de redeploy/uso (localizar no Step 1)

**Interfaces:**
- Consumes: nada.
- Produces: endpoints retornam `{ ok: false, reason: 'not_applicable_self_hosted' }` com status 501.

- [ ] **Step 1: Mapear consumidores na UI**

Run: `git grep -nE "/api/vercel/|AIGatewayPanel|/api/usage|/api/settings/domains" -- 'components/**' 'app/**' 'hooks/**'`
Expected: lista dos componentes/hooks que chamam esses endpoints (anotar para o Step 4).

- [ ] **Step 2: Stub dos endpoints Vercel**

Substituir o corpo de cada `route.ts` em `app/api/vercel/*` por um handler que sinaliza indisponibilidade. Exemplo para `redeploy`:
```typescript
import { NextResponse } from 'next/server'

// Self-hosted: redeploy é feito via Portainer/CI, não pela API da Vercel.
export async function POST() {
  return NextResponse.json(
    { ok: false, reason: 'not_applicable_self_hosted',
      message: 'Redeploy é gerenciado pelo Portainer/CI nesta instalação.' },
    { status: 501 },
  )
}
```
Aplicar o mesmo padrão (com `GET`) em `info/route.ts` e `deploy-status/route.ts`. Em `usage/route.ts`, isolar o bloco que consulta a API da Vercel (`VERCEL_API_TOKEN`) e retornar `null`/501 nessa parte, preservando métricas que venham do Supabase, se houver. Em `settings/domains/route.ts`, retornar 501 (gestão de domínio agora é no Traefik/DNS).

- [ ] **Step 3: Neutralizar `VERCEL_AUTOMATION_BYPASS_SECRET`**

Nos 3 call-sites, o header de bypass só existe na Vercel. Remover a montagem condicional do header (ou mantê-la guardada por `if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET)`, que nunca será verdade na VPS). Preferir remover o trecho para não confundir. Verificar que a chamada HTTP resultante continua válida sem esse header.

- [ ] **Step 4: Ocultar a UI**

Nos componentes mapeados no Step 1, esconder os controles atrás de uma flag simples. Adicionar em `.env.example` `NEXT_PUBLIC_ENABLE_VERCEL_OPS=false` e, nos componentes, envolver o render com:
```tsx
{process.env.NEXT_PUBLIC_ENABLE_VERCEL_OPS === 'true' && (
  /* ...painel de redeploy / uso Vercel / AIGatewayPanel... */
)}
```
Para `AIGatewayPanel.tsx`, ocultar o painel inteiro do mesmo modo (a IA continua funcionando via chave de provider configurada na UI de IA — não depende deste painel).

- [ ] **Step 5: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros; build ok.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(infra): desativar/ocultar features de ops atadas à Vercel"
```

---

### Task 6: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: `output: 'standalone'` (já em `next.config.ts`); `APP_VERSION` (Task 4).
- Produces: imagem que roda `node server.js` na porta 3000 e responde `GET /api/health`.

- [ ] **Step 1: Criar `.dockerignore`**

```
node_modules
.next
.git
.github
docs
tests
test-results
coverage
tmp
*.log
.env
.env.*
!.env.example
.claude
```

- [ ] **Step 2: Criar `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Artefatos do standalone
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Migrações exigidas por /api/installer/run-stream (outputFileTracingIncludes)
COPY --from=builder /app/supabase/migrations ./supabase/migrations

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
```

- [ ] **Step 3: Build local da imagem**

Run: `docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t smartzap-saas:local .`
Expected: build conclui sem erro.

> Nota: se o ambiente atual não tiver Docker, este passo e o Step 4 são executados na VPS/CI. Registrar o resultado no PR.

- [ ] **Step 4: Smoke test do container**

Run:
```bash
docker run --rm -p 3000:3000 --env-file .env.local smartzap-saas:local &
sleep 8
curl -fsS http://localhost:3000/api/health && echo " OK"
docker stop $(docker ps -q --filter ancestor=smartzap-saas:local)
```
Expected: `/api/health` responde 200.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(infra): Dockerfile standalone + .dockerignore"
```

---

### Task 7: `.env.example` + stack do Portainer (docker-compose + Traefik)

**Files:**
- Create: `.env.example`, `docker-compose.yml`

**Interfaces:**
- Consumes: imagem da Task 6; helper `getAppUrl()` (lê `NEXT_PUBLIC_APP_URL`).
- Produces: stack pronto para importar no Portainer.

- [ ] **Step 1: Criar `.env.example`**

```dotenv
# ── App ──────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://app.vozzyup.com.br
APP_ENV=production
NEXT_PUBLIC_ENABLE_VERCEL_OPS=false

# ── Supabase ─────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SECRET_KEY=

# ── Upstash QStash / Workflow ────────────────────────
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
QSTASH_WORKFLOW_URL=https://app.vozzyup.com.br
UPSTASH_WORKFLOW_URL=https://app.vozzyup.com.br

# ── Upstash Redis ────────────────────────────────────
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ── Auth do produto ──────────────────────────────────
MASTER_PASSWORD=
SMARTZAP_API_KEY=
SMARTZAP_ADMIN_KEY=

# ── Meta / WhatsApp (fallback; primário vem do Supabase settings) ──
META_APP_ID=
META_APP_SECRET=
META_WABA_ID=
META_PHONE_NUMBER_ID=
META_ACCESS_TOKEN=
META_GRAPH_VERSION=v24.0

# ── Push / PWA ───────────────────────────────────────
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:contato@vozzyup.com.br

# ── IA (conforme provider usado) ─────────────────────
OPENAI_API_KEY=
GEMINI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
```

> Antes do deploy, confirmar os nomes exatos das signing keys do QStash na conta Upstash (o `@upstash/qstash` Receiver usa `QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY`).

- [ ] **Step 2: Criar `docker-compose.yml` com labels do Traefik**

```yaml
services:
  smartzap:
    image: ghcr.io/OWNER/smartzap-saas:latest   # ajustar OWNER
    restart: unless-stopped
    env_file: .env
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.smartzap.rule=Host(`app.vozzyup.com.br`)"
      - "traefik.http.routers.smartzap.entrypoints=websecure"
      - "traefik.http.routers.smartzap.tls.certresolver=CERTRESOLVER"  # ajustar
      - "traefik.http.services.smartzap.loadbalancer.server.port=3000"

networks:
  traefik:
    external: true
    name: TRAEFIK_NETWORK   # ajustar para o nome da rede do Traefik existente
```

- [ ] **Step 3: Validar a sintaxe do compose**

Run: `docker compose -f docker-compose.yml config`
Expected: imprime o compose resolvido sem erro de sintaxe. (Placeholders OWNER/CERTRESOLVER/TRAEFIK_NETWORK são substituídos no deploy — ver runbook.)

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "feat(infra): .env.example e stack Portainer com labels do Traefik"
```

---

### Task 8: CI — GitHub Actions build → GHCR

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `Dockerfile` (Task 6).
- Produces: imagem `ghcr.io/OWNER/smartzap-saas:latest` + tag do SHA; dispara webhook do Portainer.

- [ ] **Step 1: Criar o workflow**

```yaml
name: Build & Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=raw,value=latest
            type=sha,format=short
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          build-args: |
            APP_VERSION=${{ github.sha }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
      - name: Trigger Portainer redeploy
        if: ${{ secrets.PORTAINER_WEBHOOK_URL != '' }}
        run: curl -fsS -X POST "${{ secrets.PORTAINER_WEBHOOK_URL }}"
```

- [ ] **Step 2: Validar o YAML**

Run: `npx --yes yaml-lint .github/workflows/deploy.yml` (ou `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"`)
Expected: sem erro de sintaxe.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(infra): build da imagem e push para GHCR + webhook Portainer"
```

> Verificação real: só ocorre após o `origin` do GitHub existir e o push para `main` disparar o workflow (ver runbook). Registrar o run verde no PR.

---

### Task 9: Runbook de cutover

**Files:**
- Create: `docs/superpowers/runbooks/2026-07-08-cutover-fase1.md`

**Interfaces:**
- Consumes: todas as tasks anteriores.
- Produces: procedimento operacional de virada.

- [ ] **Step 1: Escrever o runbook**

Conteúdo (checklist operacional):
```markdown
# Cutover Fase 1 — SmartZap na VPS

## Pré-requisitos
- [ ] Repo `smartzap-saas` criado no GitHub; `origin` apontado; branch `saas/fase-1-infra` mergeada em `main`.
- [ ] CI verde: imagem em `ghcr.io/OWNER/smartzap-saas:latest`.
- [ ] Nome da rede do Traefik e do `certresolver` confirmados na VPS.
- [ ] Webhook de redeploy do stack criado no Portainer (secret `PORTAINER_WEBHOOK_URL` no GitHub).

## Deploy
1. [ ] No Portainer, criar o stack a partir do `docker-compose.yml` (substituir OWNER/CERTRESOLVER/TRAEFIK_NETWORK).
2. [ ] Preencher as variáveis do `.env` (baseado no `.env.example`) no Portainer.
3. [ ] Subir o stack; conferir `GET https://app.vozzyup.com.br/api/health` = 200 com SSL válido.

## DNS
4. [ ] Criar registro A `app.vozzyup.com.br` → IP da VPS. Aguardar propagação; revalidar `/api/health`.

## Meta / WhatsApp
5. [ ] No painel da Meta, atualizar a Callback URL do webhook para `https://app.vozzyup.com.br/api/webhook`.
6. [ ] Revalidar `verify_token` e assinatura HMAC (enviar mensagem de teste; conferir recebimento no inbox).

## QStash
7. [ ] Confirmar `QSTASH_WORKFLOW_URL`/`UPSTASH_WORKFLOW_URL` = domínio novo.
8. [ ] Disparar 1 campanha de teste (poucos contatos) e confirmar entrega — valida o callback do QStash chegando ao novo domínio.

## PWA
9. [ ] Reassinar push (subscriptions antigas são atreladas à origem antiga). Confirmar recebimento de 1 notificação.

## Validação final
10. [ ] Login, inbox realtime, 1 fluxo com nó `ai_agent`, 1 disparo de campanha — todos OK.
11. [ ] Atualizar scripts de ops que apontam para `smartzap-eta.vercel.app` → `app.vozzyup.com.br`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/2026-07-08-cutover-fase1.md
git commit -m "docs(infra): runbook de cutover da Fase 1"
```

---

## Notas de execução

- **Docker/CI neste ambiente:** os Steps de `docker build`/`docker run`/push de CI podem não rodar na máquina de desenvolvimento (sem Docker) — nesses casos, executá-los na VPS/CI e registrar o resultado no PR. Todo o restante (helpers, refactors, `tsc`, `vitest`, `lint`, `build`) roda localmente.
- **Ordem recomendada:** Tasks 1→2→3 (código testável) antes de 4→5 (decoupling), depois 6→7→8 (empacotamento/CI) e 9 (runbook). Cada task é commit independente e revisável.
- **Pendências herdadas do spec:** criar repo no GitHub (`origin`), confirmar `certresolver`/rede do Traefik, mecanismo de redeploy do Portainer.
