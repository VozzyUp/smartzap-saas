# Fase 5A — Inbox com mídia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbox estilo WhatsApp Web para imagem, documento, vídeo e áudio — enviar (anexar arquivo) e receber, com preview/player/download. Sem gravação de voz (Fase 5B).

**Architecture:** Mídia persistida em bucket privado do Supabase Storage (`wa-inbox-media`), servida por URL assinada curta via rota escopada por tenant. Recebimento: webhook corrige o parsing (usa `media_id`, não `.url`), persiste `pending` e enfileira (QStash) o download da Meta → Storage. Envio: rota multipart sobe à Meta, envia pelo número da conversa (Fase 4) e guarda o arquivo. Reusa os builders de `lib/whatsapp/media.ts`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Storage + service role), Upstash QStash, TypeScript, Vitest, React Query, sonner.

## Global Constraints

- Mídia é dado privado: bucket **privado**, nunca público; URL sempre **assinada e curta** (300s). A rota que assina resolve o tenant via `getTenantContext` e valida que a mensagem é do tenant (nunca serve mídia de outro tenant). O access_token da Meta nunca vai ao client.
- Envio responde **pelo número da conversa** (`getWhatsAppCredentialsForNumber`, Fase 4).
- Não duplicar builders — reusar `lib/whatsapp/media.ts`. Centralizar o upload à Meta (hoje inline na campanha) e a campanha passa a usar a função centralizada **sem regressão**.
- Download da mídia recebida **fora do caminho síncrono do webhook** (QStash), pois a Meta re-tenta se o webhook demora.
- Persistência escopada por tenant (`inbox_messages.tenant_id`).
- Limites de validação no envio: imagem ≤5MB, vídeo ≤16MB, áudio ≤16MB, documento ≤100MB; whitelist de mime.
- Migração versionada em `supabase/migrations/` E aplicada via MCP (colunas + bucket privado + policies de storage).
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-5a-inbox-midia` (já criada a partir de `main`).
- Agentes commitam com `git commit -m "..." -- <arquivos>` (paths explícitos).

## File Structure

- `supabase/migrations/<ts>_inbox_media.sql` — colunas + bucket privado + policies. (T1)
- `lib/whatsapp/media.ts` + `lib/whatsapp/media.test.ts` — `uploadMediaToMeta` + `downloadMetaMedia`; campanha refatorada. (T2)
- `lib/inbox/inbox-media.ts` + test — store inbound/outbound + signed URL. (T3)
- `app/api/webhook/route.ts` + `lib/inbox/inbox-webhook.ts` — parsing correto + enqueue. (T4)
- `app/api/inbox/media/ingest/route.ts` + test — worker QStash de download. (T5)
- `lib/whatsapp-send.ts` + `app/api/inbox/conversations/[id]/media/route.ts` + test — envio de mídia. (T6)
- `app/api/inbox/media/[messageId]/route.ts` + test — signed URL. (T7)
- `components/features/inbox/MessageBubble.tsx` — renderização de mídia. (T8)
- `components/features/inbox/MessageInput.tsx` — anexo + preview + legenda. (T9)
- `docs/superpowers/runbooks/2026-07-18-fase5a-inbox-midia.md` — runbook. (T10)

---

### Task 1: Schema + bucket privado

**Files:**
- Create: `supabase/migrations/20260720000001_inbox_media.sql`

**Interfaces:**
- Produces: colunas em `inbox_messages` (`media_path`, `media_mime`, `media_filename`, `media_size`, `media_duration`, `media_status`); bucket privado `wa-inbox-media`.

- [ ] **Step 1: Escrever a migração**

```sql
begin;

alter table public.inbox_messages
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_filename text,
  add column if not exists media_size bigint,
  add column if not exists media_duration integer,
  add column if not exists media_status text not null default 'ready';
-- media_status: 'ready' (padrão p/ msgs sem mídia e mídia disponível),
-- 'pending' (mídia recebida em download), 'failed' (download falhou).

-- Bucket PRIVADO para mídia do inbox (dado do cliente). Idempotente.
insert into storage.buckets (id, name, public)
values ('wa-inbox-media', 'wa-inbox-media', false)
on conflict (id) do nothing;

-- Sem policies para 'authenticated' no bucket: o acesso é só via service role
-- nas rotas server (que assinam URLs curtas). Isso já é o default quando não há
-- policy de SELECT para authenticated — o service role ignora RLS de storage.
commit;
```

- [ ] **Step 2: Confirmar o padrão de storage do repo**

Ler `lib/installer/migrations.ts` (aguarda `storage.buckets`) e `lib/whatsapp/template-media-preview.ts` (usa `client.storage.createBucket`/`from(bucket).upload`) para confirmar a API de storage usada. Se o projeto criar buckets via `storage.create_bucket(...)` em vez de `insert into storage.buckets`, ajustar. **Não aplicar** se o padrão divergir.

- [ ] **Step 3: Aplicar via MCP**

Supabase `apply_migration` (name: `inbox_media`). Depois `execute_sql` confirmando: colunas presentes em `inbox_messages`; `select id, public from storage.buckets where id='wa-inbox-media'` → `public=false`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fase5a): schema inbox media + bucket privado wa-inbox-media" -- supabase/migrations/20260720000001_inbox_media.sql
```

---

### Task 2: `lib/whatsapp/media.ts` — upload/download à Meta (centralizar)

**Files:**
- Modify: `lib/whatsapp/media.ts`
- Modify: `app/api/campaign/workflow/route.ts` (passar a usar `uploadMediaToMeta`)
- Test: `lib/whatsapp/media.test.ts` (existe — estender)

**Interfaces:**
- Produces:
  - `uploadMediaToMeta(params: { phoneNumberId: string; accessToken: string; buffer: Buffer | Uint8Array; contentType: string; filename?: string }): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }>` — extrai a lógica hoje inline em `app/api/campaign/workflow/route.ts` (~linhas 740-770): `POST /{phoneNumberId}/media` multipart (`messaging_product=whatsapp`, `type=contentType`, `file`).
  - `downloadMetaMedia(params: { mediaId: string; accessToken: string }): Promise<{ ok: true; buffer: Buffer; mime: string; size: number } | { ok: false; status: number; error: string }>` — passo 1: `GET https://graph.facebook.com/v24.0/{mediaId}` → `{ url, mime_type, file_size }`; passo 2: `GET url` com `Authorization: Bearer` → bytes.

- [ ] **Step 1: Escrever testes falhando**

Em `lib/whatsapp/media.test.ts`, mockar `fetch` global:
- `uploadMediaToMeta`: monta multipart com `messaging_product/type/file`, chama o endpoint `/media`, retorna `{ok:true,id}`; em `!res.ok` retorna `{ok:false,status,error}`.
- `downloadMetaMedia`: 2 fetches (metadata → bytes); retorna `{ok:true,buffer,mime,size}`; erro em qualquer passo → `{ok:false,...}`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/whatsapp/media.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Adicionar as duas funções a `lib/whatsapp/media.ts` (usar `safeJson` de `@/lib/server-http` se já usado no repo, ou `res.json()` com try/catch):

```typescript
export async function uploadMediaToMeta(params: {
  phoneNumberId: string; accessToken: string; buffer: Buffer | Uint8Array; contentType: string; filename?: string
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  try {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', params.contentType)
    const bytes = new Uint8Array(params.buffer)
    form.append('file', new Blob([bytes], { type: params.contentType }), params.filename ?? 'file')
    const res = await fetch(`https://graph.facebook.com/v24.0/${params.phoneNumberId}/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${params.accessToken}` }, body: form,
    })
    const body = await res.json().catch(() => null) as any
    if (!res.ok) return { ok: false, status: res.status, error: body?.error?.message || `HTTP ${res.status}` }
    const id = String(body?.id || '').trim()
    if (!id) return { ok: false, status: res.status, error: 'Resposta sem media_id' }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function downloadMetaMedia(params: { mediaId: string; accessToken: string }): Promise<
  { ok: true; buffer: Buffer; mime: string; size: number } | { ok: false; status: number; error: string }
> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v24.0/${params.mediaId}`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    })
    const meta = await metaRes.json().catch(() => null) as any
    if (!metaRes.ok || !meta?.url) return { ok: false, status: metaRes.status, error: meta?.error?.message || 'sem url de mídia' }
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${params.accessToken}` } })
    if (!binRes.ok) return { ok: false, status: binRes.status, error: `download HTTP ${binRes.status}` }
    const buffer = Buffer.from(await binRes.arrayBuffer())
    return { ok: true, buffer, mime: meta.mime_type || 'application/octet-stream', size: Number(meta.file_size) || buffer.length }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
```

Depois, em `app/api/campaign/workflow/route.ts`, substituir o bloco inline de upload (~740-770) por uma chamada a `uploadMediaToMeta({ phoneNumberId, accessToken, buffer, contentType, filename })`, preservando o retorno `{ok,id}`/`{ok,error}` que o restante da campanha já consome. Confirmar que os campos batem (a função inline usava `params.buffer/contentType/filename` — mesmos nomes).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/whatsapp/media.test.ts` + `npx vitest run app/api/campaign` (regressão da campanha) + `npx tsc --noEmit`
Expected: PASS / limpo.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase5a): uploadMediaToMeta + downloadMetaMedia centralizados; campanha reusa" -- lib/whatsapp/media.ts lib/whatsapp/media.test.ts app/api/campaign/workflow/route.ts
```

---

### Task 3: `lib/inbox/inbox-media.ts` — persistência no Storage

**Files:**
- Create: `lib/inbox/inbox-media.ts`
- Test: `lib/inbox/inbox-media.test.ts`

**Interfaces:**
- Consumes: `downloadMetaMedia` (T2); `getSupabaseAdmin` (`@/lib/supabase`); Supabase Storage (`client.storage.from('wa-inbox-media')`).
- Produces:
  - `storeInboundMedia(params: { tenantId: string; conversationId: string; messageId: string; mediaId: string; accessToken: string }): Promise<void>` — `downloadMetaMedia` → `storage.from('wa-inbox-media').upload(path, buffer, { contentType })` em `${tenantId}/${conversationId}/${messageId}.${ext}` → `update inbox_messages set media_path, media_mime, media_size, media_status='ready' where id=messageId and tenant_id=tenantId`. Em erro (download/upload), `media_status='failed'` (não relança).
  - `storeOutboundMedia(params: { tenantId; conversationId; messageId; buffer: Buffer; mime: string; filename?: string }): Promise<string /* media_path */>`.
  - `getSignedMediaUrl(tenantId: string, messageId: string, expiresIn?: number): Promise<string | null>` — lê `media_path` da mensagem escopada por tenant; `createSignedUrl(path, expiresIn ?? 300)`; `null` se não for do tenant / sem mídia.
  - Helper `extFromMime(mime): string` (ex.: `image/jpeg`→`jpg`, `audio/ogg`→`ogg`, `application/pdf`→`pdf`; fallback `bin`).

- [ ] **Step 1: Escrever testes falhando**

Mockar `@/lib/whatsapp/media` (`downloadMetaMedia`), `@/lib/supabase` (`getSupabaseAdmin` com `.storage.from().upload/createSignedUrl` e `.from('inbox_messages').update/select`):
- `storeInboundMedia`: sucesso → upload no path certo + update `media_status='ready'`; download falha → update `media_status='failed'`, não lança.
- `getSignedMediaUrl`: mensagem de outro tenant (select retorna null) → `null`; com media_path → chama `createSignedUrl(path, 300)` e retorna a URL.
- `storeOutboundMedia`: upload no path e retorna o `media_path`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/inbox/inbox-media.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Padrão (service role; sempre `.eq('tenant_id', tenantId)` nos updates/selects; `media_status='failed'` em erro sem relançar). Bucket const `const BUCKET = 'wa-inbox-media'`. `upload(path, buffer, { contentType: mime, upsert: true })`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/inbox/inbox-media.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase5a): inbox-media (storeInbound/Outbound + getSignedMediaUrl)" -- lib/inbox/inbox-media.ts lib/inbox/inbox-media.test.ts
```

---

### Task 4: Webhook — parsing correto + persistir pending + enfileirar

**Files:**
- Modify: `app/api/webhook/route.ts` (~linha 999)
- Modify: `lib/inbox/inbox-webhook.ts` (`handleInboundMessage` / `InboundMessagePayload`)

**Interfaces:**
- Consumes: QStash client (`@upstash/qstash`, mesmo padrão de `lib/builder/workflow-schedule.ts`: `new Client({ token: process.env.QSTASH_TOKEN })`).
- Produces: mensagens recebidas de mídia persistidas com `message_type` correto, `media_status='pending'`, e um job QStash disparado para `/api/inbox/media/ingest`.

- [ ] **Step 1: Corrigir o parsing no webhook**

Em `app/api/webhook/route.ts` (~999), o payload da Meta para mídia é `message.<type> = { id, mime_type, sha256, caption?, filename? (document) }`. Trocar o `mediaUrl: message.image?.url || ...` por extrair, conforme `messageType`:
- `mediaId = message[messageType]?.id`
- `mediaMime = message[messageType]?.mime_type`
- `mediaFilename = message.document?.filename`
- `caption = message[messageType]?.caption`
Passar esses campos a `handleInboundMessage`.

- [ ] **Step 2: Estender `handleInboundMessage` / `InboundMessagePayload`**

Em `lib/inbox/inbox-webhook.ts`: adicionar ao payload `mediaId?`, `mediaMime?`, `mediaFilename?`, `caption?`. Ao persistir a mensagem recebida de mídia:
- `message_type` = o tipo (`image|audio|video|document|sticker`);
- `media_mime`/`media_filename` do payload; `media_status='pending'`; `content` = `caption` (ou vazio);
- NÃO gravar `media_path` ainda (vem no ingest).
Depois de persistir, se houver `mediaId`, **enfileirar** via QStash um `POST` para `${APP_URL}/api/inbox/media/ingest` com `{ tenantId, conversationId, messageId, mediaId }`. Usar `getAppUrl()` (helper do repo, Fase 1) para a URL base. Se `QSTASH_TOKEN` ausente (dev), fazer fallback chamando o ingest inline (import dinâmico de `storeInboundMedia` + resolver credenciais) — documentar; nunca travar o webhook.

- [ ] **Step 3: Teste**

Adicionar/ajustar teste do webhook/inbox-webhook: para uma mensagem `image` com `{ id:'mid_1', mime_type:'image/jpeg', caption:'oi' }`, `handleInboundMessage` persiste `message_type='image'`, `media_status='pending'`, `content='oi'`, e dispara o enqueue (mock do QStash client). Rodar: `npx vitest run lib/inbox`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fase5a): webhook parseia media_id (nao url) e enfileira download da midia recebida" -- app/api/webhook/route.ts lib/inbox/inbox-webhook.ts
```

---

### Task 5: Rota worker `/api/inbox/media/ingest`

**Files:**
- Create: `app/api/inbox/media/ingest/route.ts`
- Test: `app/api/inbox/media/ingest/route.test.ts`

**Interfaces:**
- Consumes: `storeInboundMedia` (T3); `getWhatsAppCredentialsForNumber`/`getWhatsAppCredentials` (Fase 4) para o token; verificação de assinatura QStash (`Receiver` de `@upstash/qstash`, se já usada no repo; senão validar via `verifySignatureAppRouter`/segredo — seguir o padrão existente de webhooks QStash do repo).
- Produces: baixa a mídia e atualiza a mensagem para `ready`/`failed`.

- [ ] **Step 1: Escrever teste falhando**

Mock `storeInboundMedia` e a resolução de credenciais. POST com corpo `{ tenantId, conversationId, messageId, mediaId }` (assinatura QStash válida mockada) → chama `storeInboundMedia` com o token resolvido. Assinatura inválida → 401.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run app/api/inbox/media/ingest/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Verificar assinatura QStash (procurar no repo como outros endpoints QStash validam — reusar esse util). Resolver o token do tenant (o token do número ativo/legado via `getWhatsAppCredentials(tenantId)` é suficiente para baixar mídia; a mídia é do WABA do tenant). Chamar `storeInboundMedia({ tenantId, conversationId, messageId, mediaId, accessToken })`. Retornar 200 (mesmo em falha de download, que já marca `failed` — evita re-tentativas infinitas do QStash; ou 500 para permitir re-try limitado — escolher e documentar).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run app/api/inbox/media/ingest/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase5a): rota QStash /api/inbox/media/ingest baixa midia recebida" -- app/api/inbox/media/ingest/
```

---

### Task 6: Envio de mídia (lib + rota)

**Files:**
- Modify: `lib/whatsapp-send.ts` (suportar tipos de mídia)
- Create: `app/api/inbox/conversations/[id]/media/route.ts`
- Test: `app/api/inbox/conversations/[id]/media/route.test.ts`

**Interfaces:**
- Consumes: `uploadMediaToMeta` (T2); builders de `lib/whatsapp/media.ts` (`buildImageMessage` etc.); `getWhatsAppCredentialsForNumber` (Fase 4); `storeOutboundMedia` (T3); criação de mensagem do inbox (`lib/inbox`/`lib/supabase-db`).
- Produces: envio de `image|audio|video|document` a partir de um arquivo, persistido no inbox.

- [ ] **Step 1: Estender o envio**

Em `lib/whatsapp-send.ts`: estender o union `WhatsAppMessage.type` para incluir `'image'|'audio'|'video'|'document'` e montar o corpo a partir dos builders de `media.ts` (que já produzem `{ type, image:{id}|link, ... }`). Não alterar text/template/reaction/interactive. (Alternativa aceitável: novo `sendWhatsAppMedia(tenantId, { to, mediaId, type, caption, filename }, credentials)` que reusa o transport HTTP existente — escolher a que menos toca o código atual; documentar.)

- [ ] **Step 2: Teste da rota falhando**

`POST /api/inbox/conversations/[id]/media` (multipart com `file` + `caption?`): 401 sem sessão; 400 tipo/tamanho inválido (mock de um arquivo grande); sucesso (mock `uploadMediaToMeta`→id, envio, `storeOutboundMedia`) → 200 e mensagem outbound persistida com `media_path`/`message_type`.

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run app/api/inbox/conversations`

- [ ] **Step 4: Implementar a rota**

`getTenantContext`→401. Ler o multipart (`await request.formData()`), pegar `file` (Blob) e `caption`. Determinar `message_type` pelo mime (image/*, video/*, audio/*, senão document). Validar tamanho por tipo (imagem 5MB, vídeo/áudio 16MB, documento 100MB) e whitelist de mime → 400. Resolver o número da conversa (`getWhatsAppCredentialsForNumber(tenantId, conversation.whatsapp_number_id)`). `uploadMediaToMeta` → media_id. Montar via builder + enviar (Step 1). Persistir a mensagem outbound (criar antes p/ ter `messageId`, então `storeOutboundMedia` com esse id, e atualizar `media_path`). Retornar `{ success:true }`.

- [ ] **Step 5: Rodar e ver passar** — `npx vitest run app/api/inbox/conversations` + `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(fase5a): envio de midia no inbox (upload Meta + builders + persiste) pelo numero da conversa" -- lib/whatsapp-send.ts app/api/inbox/conversations/
```

---

### Task 7: Rota de leitura (signed URL)

**Files:**
- Create: `app/api/inbox/media/[messageId]/route.ts`
- Test: `app/api/inbox/media/[messageId]/route.test.ts`

**Interfaces:**
- Consumes: `getTenantContext`; `getSignedMediaUrl` (T3).
- Produces: `GET` que redireciona (302) para a signed URL curta da mídia da mensagem (escopada por tenant).

- [ ] **Step 1: Teste falhando**

401 sem sessão; 404 quando `getSignedMediaUrl` retorna null (mídia de outro tenant/ausente); 302 com `Location` = signed URL quando existe. (Next 16: `params` é Promise → `await params`.)

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run app/api/inbox/media/[messageId]`

- [ ] **Step 3: Implementar**

```typescript
export async function GET(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { messageId } = await params
  const url = await getSignedMediaUrl(ctx.tenantId, messageId)
  if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.redirect(url, 302)
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run app/api/inbox/media/[messageId]`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(fase5a): rota GET /api/inbox/media/[messageId] com signed URL escopada por tenant" -- app/api/inbox/media/
```

---

### Task 8: UI — renderização de mídia no `MessageBubble`

**Files:**
- Modify: `components/features/inbox/MessageBubble.tsx`

**Interfaces:**
- Consumes: `GET /api/inbox/media/[messageId]` como `src`; campos `message_type`, `media_mime`, `media_filename`, `media_size`, `media_status` da mensagem.

- [ ] **Step 1: Renderizar por tipo**

No `MessageBubble`, quando `message_type` ∈ {image, video, audio, document}:
- `media_status==='pending'` → placeholder "Recebendo mídia…" (spinner). `failed` → "Mídia indisponível".
- `ready`: `image` → `<img src="/api/inbox/media/{id}">` (thumb, clique abre lightbox/nova aba); `video` → `<video controls src=...>`; `audio` → `<audio controls src=...>` (+ duração se houver); `document` → ícone + `media_filename` + tamanho + link de download (`<a href=... download>`).
- Legenda (`content`) renderizada abaixo da mídia quando houver.
Seguir o estilo/spacing das bolhas atuais (não quebrar texto/template). Verificar `npx tsc --noEmit` e `npm run build`.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(fase5a): MessageBubble renderiza imagem/video/audio/documento" -- components/features/inbox/MessageBubble.tsx
```

---

### Task 9: UI — anexo no `MessageInput`

**Files:**
- Modify: `components/features/inbox/MessageInput.tsx`
- Modify: `components/features/inbox/MessagePanel.tsx` (fiação do envio de mídia, se necessário)

**Interfaces:**
- Consumes: `POST /api/inbox/conversations/[id]/media`.

- [ ] **Step 1: Anexo + preview + legenda**

Adicionar botão 📎 → `<input type="file" accept="image/*,video/*,audio/*,application/pdf,...">`. Ao escolher: mostrar **preview** (imagem/vídeo) ou nome do arquivo (documento), campo de legenda opcional, botões enviar/cancelar. Ao enviar: `POST` multipart para a conversa atual; estado "enviando…"; on sucesso limpa e a bolha aparece via realtime; on erro `toast.error`. Não quebrar o envio de texto atual (`onSend`). Validar tamanho/tipo no client também (feedback rápido), mas o server é a autoridade. (Sem microfone — 5B.) Verificar `tsc`/`build`.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(fase5a): MessageInput com anexo (arquivo + preview + legenda)" -- components/features/inbox/MessageInput.tsx components/features/inbox/MessagePanel.tsx
```

---

### Task 10: Fechamento

**Files:**
- Create: `docs/superpowers/runbooks/2026-07-18-fase5a-inbox-midia.md`

- [ ] **Step 1: Suíte + build**

`npx vitest run` (sem regressão), `npx tsc --noEmit`, `npm run build`. Confirmar que a campanha continua enviando mídia (regressão do `uploadMediaToMeta`).

- [ ] **Step 2: Runbook**

Documentar: entregue; migração + bucket aplicados; **variáveis/infra** (QStash já configurado; bucket privado `wa-inbox-media`); smoke test (receber imagem/áudio/documento → aparece na bolha; enviar cada tipo → chega no WhatsApp do cliente pelo número da conversa; documento faz download; mídia de outro tenant não acessível); rollback (colunas inertes, bucket permanece); nota de que gravação de voz é a 5B (ffmpeg).

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(fase5a): runbook inbox midia" -- docs/superpowers/runbooks/2026-07-18-fase5a-inbox-midia.md
```

---

## Execução

Dependências (arquivos/símbolos):
- **T1 (schema+bucket)** primeiro. **T2 (media lib)** após T1. **T3 (inbox-media)** após T2 (usa `downloadMetaMedia`).
- **T4 (webhook)** após T1 (colunas) — pode ir junto com T2/T3 pois toca arquivos disjuntos, mas enfileira p/ a rota da T5. **T5 (ingest)** após T3.
- **T6 (envio)** após T2+T3. **T7 (signed URL)** após T3.
- **T8 (bubble)** após T7 (usa a rota). **T9 (input)** após T6 (usa a rota).
- **T10** por último.

Paralelismo seguro (arquivos disjuntos): depois de T3, **T5 ∥ T6 ∥ T7**; depois, **T8 ∥ T9**. O resto sequencial. Cada agente usa `git commit -m "..." -- <arquivos>`. Review por camada; review final de branch inteira antes do merge.
