# Fase 3.2 — Login por e-mail/senha + trial de 3 dias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir magic link por login/cadastro/reset com e-mail+senha e dar a todo tenant novo um trial de 3 dias com bloqueio na expiração.

**Architecture:** Auth continua 100% Supabase Auth com cookies via `@supabase/ssr`; as ações de auth são rotas server-side em `/api/auth/*` (mesmo padrão do magic-link atual), consumidas por páginas client em `app/(auth)/`. O trial vive em `tenants.trial_ends_at`, é gravado no provisionamento, exposto por `getTenantContext()` e aplicado em 3 gates: layout do dashboard (redirect), dispatch de campanha (403) e worker de IA (no-op).

**Tech Stack:** Next.js 16 App Router, Supabase Auth (`signInWithPassword`/`signUp`/`resetPasswordForEmail`/`updateUser`), Vitest.

## Global Constraints

- Supabase Auth é o provedor — nada de tabela própria de senhas.
- Confirmação de e-mail LIGADA no signup (config manual no dashboard, ver Task 7).
- Tenants existentes: `trial_ends_at = NULL` = sem limite. Platform admin nunca é bloqueado por trial.
- Falha fechada: sem sessão → `/login`; trial expirado → `/trial-expirado`; nunca 500 por gate.
- Redirects absolutos SEMPRE via `getAppUrl()` (`lib/app-url.ts`) — nunca `request.url`.
- Mensagens anti-enumeração: login falho = "E-mail ou senha inválidos"; signup/forgot sempre respondem sucesso opaco.
- Baseline: `tsc --noEmit` limpo, `npx vitest run` = 3456 passed / 6 skipped, `npm run build` ok. Sem regressão.
- Branch: `saas/fase-3-2-auth-senha-trial` a partir de `main`.

---

### Task 1: Migração `trial_ends_at` + provisionamento grava trial

**Files:**
- Create: `supabase/migrations/20260714000001_trial_ends_at.sql`
- Modify: `lib/tenant-provisioning.ts`
- Test: `lib/tenant-provisioning.test.ts` (existente — adicionar caso)

**Interfaces:**
- Consumes: `getSupabaseAdmin()` de `@/lib/supabase` (já usado no arquivo).
- Produces: coluna `tenants.trial_ends_at timestamptz`; `provisionTenantForUser` insere `trial_ends_at` ISO string = agora+3 dias em tenant novo. Assinatura NÃO muda: `provisionTenantForUser(userId: string, emailForName: string): Promise<{ tenantId: string; created: boolean }>`.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/20260714000001_trial_ends_at.sql
-- Fase 3.2: trial de 3 dias por tenant.
-- NULL = sem limite (tenants pré-existentes/grandfathered, ou pago na Fase 3.3).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
COMMENT ON COLUMN tenants.trial_ends_at IS 'NULL = sem limite. Trial expirado quando now() > trial_ends_at.';
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

Aplicar via MCP do Supabase (`apply_migration` com o mesmo nome/conteúdo) ou instruir o controlador a aplicar. Verificar com `SELECT column_name FROM information_schema.columns WHERE table_name='tenants' AND column_name='trial_ends_at'` → 1 linha.

- [ ] **Step 3: Escrever o teste que falha**

Adicionar a `lib/tenant-provisioning.test.ts` (seguir o padrão de mock já existente no arquivo — o mock de `getSupabaseAdmin` encadeia `from().insert().select().single()`; capturar o objeto passado ao `insert` de `tenants`):

```ts
it('grava trial_ends_at ~3 dias no futuro ao criar tenant novo', async () => {
  // usar o mesmo harness de mocks do teste 'cria tenant' existente,
  // capturando o payload do insert em `tenants`
  const before = Date.now() + 3 * 24 * 60 * 60 * 1000 - 5000
  const after = Date.now() + 3 * 24 * 60 * 60 * 1000 + 5000
  await provisionTenantForUser('u-novo', 'novo@empresa.com')
  const payload = insertedTenantsPayload() // helper do harness: último insert em 'tenants'
  expect(payload.trial_ends_at).toBeDefined()
  const ts = new Date(payload.trial_ends_at).getTime()
  expect(ts).toBeGreaterThan(before)
  expect(ts).toBeLessThan(after)
})
```

(Se o harness atual não expõe o payload do insert, estender o mock para gravar os argumentos — sem mudar os testes existentes.)

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run lib/tenant-provisioning.test.ts`
Expected: FAIL — `trial_ends_at` undefined no payload.

- [ ] **Step 5: Implementar**

Em `lib/tenant-provisioning.ts`, trocar o insert:

```ts
const inserted = await db.from('tenants').insert({
  name: emailForName, slug: slugFromEmail(emailForName), status: 'trialing',
  trial_ends_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
}).select('id').single()
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run lib/tenant-provisioning.test.ts`
Expected: PASS (todos os casos, incluindo os pré-existentes).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260714000001_trial_ends_at.sql lib/tenant-provisioning.ts lib/tenant-provisioning.test.ts
git commit -m "feat(3.2): tenants.trial_ends_at + provisionamento grava trial de 3 dias"
```

---

### Task 2: `lib/trial.ts` — helpers de expiração (TDD)

**Files:**
- Create: `lib/trial.ts`
- Test: `lib/trial.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` de `@/lib/supabase`.
- Produces:
  - `isTrialExpired(trialEndsAt: string | null | undefined): boolean` — pura.
  - `isTenantTrialExpired(tenantId: string): Promise<boolean>` — lê `tenants.trial_ends_at` via admin; erro/linha ausente → `false` (gate de trial não pode derrubar fluxo por falha de leitura; a autorização em si já foi feita pelos gates de tenant).

- [ ] **Step 1: Teste que falha**

```ts
// lib/trial.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))

import { isTrialExpired, isTenantTrialExpired } from '@/lib/trial'

describe('isTrialExpired', () => {
  it('NULL/undefined → false (sem limite)', () => {
    expect(isTrialExpired(null)).toBe(false)
    expect(isTrialExpired(undefined)).toBe(false)
  })
  it('futuro → false', () => {
    expect(isTrialExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false)
  })
  it('passado → true', () => {
    expect(isTrialExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true)
  })
})

describe('isTenantTrialExpired', () => {
  beforeEach(() => maybeSingle.mockReset())
  it('tenant com trial passado → true', async () => {
    maybeSingle.mockResolvedValue({ data: { trial_ends_at: new Date(Date.now() - 1000).toISOString() } })
    expect(await isTenantTrialExpired('t1')).toBe(true)
  })
  it('tenant com trial futuro → false', async () => {
    maybeSingle.mockResolvedValue({ data: { trial_ends_at: new Date(Date.now() + 60_000).toISOString() } })
    expect(await isTenantTrialExpired('t1')).toBe(false)
  })
  it('tenant sem linha ou erro → false (não derruba fluxo)', async () => {
    maybeSingle.mockResolvedValue({ data: null })
    expect(await isTenantTrialExpired('t1')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/trial.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// lib/trial.ts
import { getSupabaseAdmin } from '@/lib/supabase'

export function isTrialExpired(trialEndsAt: string | null | undefined): boolean {
  if (!trialEndsAt) return false
  return new Date(trialEndsAt).getTime() <= Date.now()
}

export async function isTenantTrialExpired(tenantId: string): Promise<boolean> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return false
    const { data } = await db.from('tenants').select('trial_ends_at').eq('id', tenantId).maybeSingle()
    return isTrialExpired(data?.trial_ends_at ?? null)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run lib/trial.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trial.ts lib/trial.test.ts
git commit -m "feat(3.2): lib/trial — isTrialExpired/isTenantTrialExpired"
```

---

### Task 3: `getTenantContext` expõe `trialExpired`

**Files:**
- Modify: `lib/tenant-context.ts`

**Interfaces:**
- Consumes: `isTrialExpired` de `@/lib/trial` (Task 2).
- Produces: `TenantContext` ganha `trialExpired: boolean`. Sempre `false` para platform admin e para `trial_ends_at` NULL. Nenhum consumidor existente quebra (campo novo).

- [ ] **Step 1: Implementar**

```ts
// lib/tenant-context.ts (arquivo completo resultante)
import { createClient } from '@/lib/supabase-server'
import { isTrialExpired } from '@/lib/trial'

export type TenantContext = {
  tenantId: string | null
  userId: string
  isPlatformAdmin: boolean
  trialExpired: boolean
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return null
  const [{ data: tenantId }, { data: isAdmin }] = await Promise.all([
    supa.rpc('current_tenant_id'),
    supa.rpc('is_platform_admin', { uid: user.id }),
  ])
  const resolvedTenantId = (tenantId as string) ?? null
  let trialExpired = false
  if (resolvedTenantId && !isAdmin) {
    const { data: tenantRow } = await supa
      .from('tenants').select('trial_ends_at').eq('id', resolvedTenantId).maybeSingle()
    trialExpired = isTrialExpired(tenantRow?.trial_ends_at ?? null)
  }
  return { tenantId: resolvedTenantId, userId: user.id, isPlatformAdmin: !!isAdmin, trialExpired }
}
```

Manter `resolveWebhookTenantId` intocado. Nota: a leitura usa o client de sessão — a RLS da 2A permite membro ler o próprio tenant; se algum teste de rota mockar `getTenantContext`, o mock só precisa incluir `trialExpired: false`.

- [ ] **Step 2: Verificar tipos e suíte**

Run: `npx tsc --noEmit` → limpo. `npx vitest run` → mocks de `getTenantContext` que declarem tipo explícito podem precisar do campo novo; atualizar apenas onde o `tsc`/vitest apontar.

- [ ] **Step 3: Commit**

```bash
git add lib/tenant-context.ts
git commit -m "feat(3.2): getTenantContext expõe trialExpired (admin e NULL isentos)"
```

---

### Task 4: Rotas de auth por senha (`/api/auth/*`) + callback com `next`

**Files:**
- Create: `app/api/auth/login/route.ts`, `app/api/auth/signup/route.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/auth/update-password/route.ts`
- Modify: `app/api/auth/callback/route.ts`
- Delete: `app/api/auth/magic-link/route.ts`
- Test: `app/api/auth/login/route.test.ts`, `app/api/auth/signup/route.test.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase-server`, `getAppUrl` de `@/lib/app-url`, `provisionTenantForUser` (callback, já existente).
- Produces: contratos JSON: `POST /api/auth/login {email,password}` → `{success:true}` | 401 `{error:'E-mail ou senha inválidos'}`; `POST /api/auth/signup {email,password}` → `{success:true}` sempre que input válido (sucesso opaco); `POST /api/auth/forgot-password {email}` → `{success:true}` sempre; `POST /api/auth/update-password {password}` → `{success:true}` | 401 se sem sessão. Callback aceita `?next=` interno seguro.

- [ ] **Step 1: Testes que falham (login e signup)**

```ts
// app/api/auth/login/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const signInWithPassword = vi.fn()
vi.mock('@/lib/supabase-server', () => ({ createClient: async () => ({ auth: { signInWithPassword } }) }))
import { POST } from './route'

const req = (body: unknown) => new Request('http://x/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/auth/login', () => {
  beforeEach(() => signInWithPassword.mockReset())
  it('200 com credenciais válidas', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const res = await POST(req({ email: 'a@b.com', password: 'senha123' }) as any)
    expect(res.status).toBe(200)
  })
  it('401 com credencial inválida — mensagem genérica', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } })
    const res = await POST(req({ email: 'a@b.com', password: 'errada' }) as any)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('E-mail ou senha inválidos')
  })
  it('400 sem email ou senha', async () => {
    const res = await POST(req({ email: 'a@b.com' }) as any)
    expect(res.status).toBe(400)
  })
})
```

```ts
// app/api/auth/signup/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const signUp = vi.fn()
vi.mock('@/lib/supabase-server', () => ({ createClient: async () => ({ auth: { signUp } }) }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))
import { POST } from './route'

const req = (body: unknown) => new Request('http://x/api/auth/signup', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/auth/signup', () => {
  beforeEach(() => signUp.mockReset())
  it('200 e emailRedirectTo aponta pro callback', async () => {
    signUp.mockResolvedValue({ data: {}, error: null })
    const res = await POST(req({ email: 'novo@b.com', password: 'senha123' }) as any)
    expect(res.status).toBe(200)
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ emailRedirectTo: 'https://app.test/api/auth/callback' }),
    }))
  })
  it('200 opaco mesmo com e-mail já cadastrado (anti-enumeração)', async () => {
    signUp.mockResolvedValue({ data: {}, error: { message: 'User already registered' } })
    const res = await POST(req({ email: 'ja@b.com', password: 'senha123' }) as any)
    expect(res.status).toBe(200)
  })
  it('400 com senha < 8 chars', async () => {
    const res = await POST(req({ email: 'a@b.com', password: '123' }) as any)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run app/api/auth/login/route.test.ts app/api/auth/signup/route.test.ts` → FAIL (módulos não existem).

- [ ] **Step 3: Implementar as 4 rotas**

```ts
// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'E-mail e senha são obrigatórios' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    return NextResponse.json({ error: 'E-mail ou senha inválidos' }, { status: 401 })
  }
  return NextResponse.json({ success: true })
}
```

```ts
// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getAppUrl } from '@/lib/app-url'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || password.length < 8) {
    return NextResponse.json({ error: 'E-mail válido e senha com no mínimo 8 caracteres' }, { status: 400 })
  }
  const supabase = await createClient()
  // Resposta sempre opaca (anti-enumeração): erros de "já cadastrado" não vazam.
  await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: `${getAppUrl(request.nextUrl.origin)}/api/auth/callback` },
  })
  return NextResponse.json({ success: true })
}
```

```ts
// app/api/auth/forgot-password/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getAppUrl } from '@/lib/app-url'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) return NextResponse.json({ error: 'E-mail é obrigatório' }, { status: 400 })
  const supabase = await createClient()
  // Sucesso opaco sempre — não revela se o e-mail existe.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl(request.nextUrl.origin)}/api/auth/callback?next=/reset-password`,
  })
  return NextResponse.json({ success: true })
}
```

```ts
// app/api/auth/update-password/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8) {
    return NextResponse.json({ error: 'Senha com no mínimo 8 caracteres' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return NextResponse.json({ error: 'Não foi possível atualizar a senha' }, { status: 400 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Callback aceita `next` interno seguro**

Em `app/api/auth/callback/route.ts`, trocar a linha `return NextResponse.redirect(new URL('/', baseUrl))` por:

```ts
    const nextParam = request.nextUrl.searchParams.get('next')
    // Só caminhos internos (começam com "/" e não "//") — nunca URL externa.
    const nextPath = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/'
    return NextResponse.redirect(new URL(nextPath, baseUrl))
```

(Manter o restante do arquivo intocado, incluindo `provisionTenantForUser` — recovery também passa por ele, é idempotente.)

- [ ] **Step 5: Deletar o magic-link**

```bash
git rm app/api/auth/magic-link/route.ts
```

Rodar `grep -rn "magic-link" app/ lib/ --include="*.ts" --include="*.tsx"` — o único consumidor é `app/(auth)/login/page.tsx` (Task 5 troca). Se aparecer outro, atualizar.

- [ ] **Step 6: Rodar testes e ver passar**

Run: `npx vitest run app/api/auth/` → PASS. `npx tsc --noEmit` → limpo (a página de login ainda referencia `/api/auth/magic-link` por URL string — não é erro de tipo; Task 5 resolve).

- [ ] **Step 7: Commit**

```bash
git add app/api/auth/
git commit -m "feat(3.2): rotas de auth por senha (login/signup/forgot/update) e remoção do magic-link"
```

---

### Task 5: Páginas de auth + tela de trial expirado + proxy

**Files:**
- Modify: `app/(auth)/login/page.tsx`, `proxy.ts:23`
- Create: `app/(auth)/signup/page.tsx`, `app/(auth)/forgot-password/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/trial-expirado/page.tsx`

**Interfaces:**
- Consumes: contratos JSON da Task 4.
- Produces: páginas públicas `/signup`, `/forgot-password`, `/reset-password`, `/trial-expirado` (adicionadas a `PUBLIC_PAGES` no proxy).

- [ ] **Step 1: Reescrever a tela de login**

Substituir o `LoginForm` em `app/(auth)/login/page.tsx` (manter logo, card, footer e classes visuais existentes — mudar só o formulário e o handler):

```tsx
function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Preencha e-mail e senha'); return }
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erro ao entrar')
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar')
    } finally {
      setIsLoading(false)
    }
  }
  // JSX: input de e-mail igual ao atual; adicionar input type="password"
  // (mesmas classes, ícone Lock de lucide-react, autoComplete="current-password");
  // botão "Entrar"; abaixo do botão, dois links:
  // <a href="/forgot-password">Esqueci minha senha</a> · <a href="/signup">Criar conta</a>
  // (classes: text-sm text-[var(--ds-text-secondary)] hover:text-emerald-500)
}
```

Remover estado `sent` e o bloco de "Cheque seu email".

- [ ] **Step 2: Criar signup**

`app/(auth)/signup/page.tsx` — mesma casca visual do login (copiar logo/card/footer). Formulário: e-mail, senha, confirmar senha. Validação client: senha ≥ 8 e igual à confirmação. Submit → `POST /api/auth/signup`; sucesso → trocar card por mensagem "Conta criada! Confira seu e-mail para confirmar o cadastro." (reutilizar o padrão visual do bloco `sent` antigo do login, com `CheckCircle2`). Link "Já tenho conta" → `/login`.

- [ ] **Step 3: Criar forgot-password e reset-password**

`app/(auth)/forgot-password/page.tsx` — campo e-mail → `POST /api/auth/forgot-password` → sempre mostra "Se o e-mail existir, enviamos um link de redefinição." Link de volta pro `/login`.

`app/(auth)/reset-password/page.tsx` — campos senha + confirmação (validação ≥ 8 e iguais) → `POST /api/auth/update-password` → sucesso: mensagem "Senha atualizada" + botão "Ir para o app" (`window.location.href = '/'`). Se a rota retornar 401 (sessão de recovery ausente/expirada), mostrar "Link expirado — solicite novamente" com link pra `/forgot-password`.

- [ ] **Step 4: Criar tela de trial expirado**

```tsx
// app/trial-expirado/page.tsx (server component, fora do shell do dashboard)
export default function TrialExpiradoPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">Seu período de teste terminou</h1>
        <p className="text-[var(--ds-text-secondary)] mt-3">
          Seus dados estão preservados. Para continuar usando o SmartZap, fale com a gente.
        </p>
        <a
          href="mailto:contato@vozzyup.com.br?subject=Assinatura%20SmartZap"
          className="inline-block w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-xl transition-colors"
        >
          Falar com o time
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Proxy — páginas públicas**

Em `proxy.ts:23`, trocar:

```ts
const PUBLIC_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password', '/trial-expirado', '/install', '/debug-auth', '/f', '/atendimento', '/docs']
```

(`/trial-expirado` precisa ser alcançável por usuário logado com trial vencido — o gate da Task 6 redireciona pra cá; mantê-lo em PUBLIC_PAGES evita loop de redirect.)

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit` → limpo. `npx vitest run` → sem regressão. `npm run build` → passa.

- [ ] **Step 7: Commit**

```bash
git add "app/(auth)/" app/trial-expirado/ proxy.ts
git commit -m "feat(3.2): telas de login por senha, cadastro, reset e trial expirado"
```

---

### Task 6: Gates de trial (dashboard, dispatch, IA)

**Files:**
- Modify: `app/(dashboard)/layout.tsx`, `app/api/campaign/dispatch/route.ts`, `app/api/ai/respond/route.ts`

**Interfaces:**
- Consumes: `getTenantContext().trialExpired` (Task 3), `isTenantTrialExpired(tenantId)` (Task 2).
- Produces: dashboard redireciona; dispatch retorna 403 `{error:'trial_expired'}`; worker de IA no-op silencioso (200) com trial expirado.

- [ ] **Step 1: Gate no layout do dashboard**

```tsx
// app/(dashboard)/layout.tsx (arquivo completo resultante)
import { redirect } from 'next/navigation'
import { getTenantContext } from '@/lib/tenant-context'
import { DashboardShell } from './DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getTenantContext()
  if (ctx?.trialExpired) redirect('/trial-expirado')
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
```

(Sem sessão o proxy já manda pro `/login` — o layout não duplica esse gate.)

- [ ] **Step 2: Gate no dispatch**

Em `app/api/campaign/dispatch/route.ts`, logo após `const tenantId: string = campaignRow.tenant_id` (linha ~217):

```ts
  const { isTenantTrialExpired } = await import('@/lib/trial')
  if (await isTenantTrialExpired(tenantId)) {
    return NextResponse.json({ error: 'trial_expired' }, { status: 403 })
  }
```

(Import dinâmico segue o padrão do arquivo para dependências fora do caminho quente; se o arquivo usa imports estáticos no topo, usar import estático — seguir o idioma local.)

- [ ] **Step 3: Gate no worker de IA**

Em `app/api/ai/respond/route.ts`, logo após `const tenantId = await getConversationTenantId(conversationId)` e o guard de tenant nulo (linha ~117):

```ts
  const { isTenantTrialExpired } = await import('@/lib/trial')
  if (await isTenantTrialExpired(tenantId)) {
    console.log(`[AI-RESPOND] trial expirado para tenant ${tenantId} — resposta suprimida`)
    return NextResponse.json({ success: true, skipped: 'trial_expired' })
  }
```

(200 de propósito: o QStash não deve re-tentar; a mensagem recebida já foi persistida pelo webhook.)

- [ ] **Step 4: Testes dos gates**

Adicionar a `lib/trial.test.ts` já cobre a lógica; para os gates, teste de rota apenas onde já existe arquivo de teste da rota (verificar `app/api/campaign/dispatch/route.test.ts` — se existir, adicionar caso 403; se não existir, NÃO criar suíte nova para rota de 2k linhas: cobertura fica no teste de `lib/trial.ts` + verificação manual).

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit` → limpo. `npx vitest run` → sem regressão. `npm run build` → passa.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/layout.tsx" app/api/campaign/dispatch/route.ts app/api/ai/respond/route.ts
git commit -m "feat(3.2): gates de trial — dashboard redirect, dispatch 403, IA no-op"
```

---

### Task 7: Fechamento — config manual, varredura e runbook

**Files:**
- Modify: `docs/superpowers/runbooks/2026-07-09-cutover-fase2a-2b.md` (ou runbook novo `docs/superpowers/runbooks/2026-07-14-fase3-2-auth-senha.md`)

- [ ] **Step 1: Varredura de resíduos**

```bash
grep -rn "magic-link\|signInWithOtp" app/ lib/ --include="*.ts" --include="*.tsx"
```
Expected: nenhuma ocorrência (fora de comentários históricos em docs).

- [ ] **Step 2: Suíte completa + build**

Run: `npx tsc --noEmit` → limpo; `npx vitest run` → ≥ 3456 passed + novos, 0 fail; `npm run build` → passa.

- [ ] **Step 3: Runbook de cutover (config manual do Supabase)**

Criar `docs/superpowers/runbooks/2026-07-14-fase3-2-auth-senha.md` com o checklist manual:
1. Supabase dashboard → Auth → Providers → Email: **Confirm email = ON**; **Minimum password length = 8**.
2. Auth → URL Configuration: conferir que `https://app.vozzyup.com.br/api/auth/callback` está nas Redirect URLs (já deve estar da 2B) — o fluxo de reset usa `?next=/reset-password` na mesma URL, não precisa de entrada nova.
3. Contas existentes definem senha via `/forgot-password` (fluxo de reset).
4. Smoke test pós-deploy: cadastro novo → e-mail de confirmação chega (SMTP custom) → confirmar → app provisiona tenant com trial; login por senha; reset de senha; tenant com `trial_ends_at` no passado (setar manualmente via SQL num tenant de teste) → dashboard redireciona pra `/trial-expirado`, dispatch retorna 403.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/runbooks/
git commit -m "docs(3.2): runbook de cutover — auth por senha + trial"
```

---

## Notas de execução

- Ordem: 1 → 2 → 3 → 4 → 5 → 6 → 7 (cadeia de dependência real: 3 depende de 2; 5 depende de 4; 6 depende de 2+3).
- Tasks 1+2 são pequenas e mecânicas; 4 e 5 são as maiores.
- A migração da Task 1 precisa ser aplicada no Supabase ANTES do deploy do código da Task 3 (o select de `trial_ends_at` falharia sem a coluna — inofensivo com `maybeSingle`, mas o trial não funcionaria).
