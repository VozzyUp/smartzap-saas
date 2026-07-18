# Fase 5A — Inbox com mídia (imagem, documento, vídeo, áudio) — Design

**Contexto:** O inbox hoje é só texto/template. Enviar: `inbox-service.sendMessage` só faz `text`/`template`; `lib/whatsapp-send.ts` só monta `text`/`template`/`reaction`/`interactive`. Receber: o webhook identifica o tipo de mídia mas grava `message.image.url` — **errado**, a Meta manda um `media_id`, não URL (e a URL da Meta expira em ~5 min e exige o token). `MessageInput.tsx` é só texto; `MessageBubble.tsx` mostra só um emoji para mídia, não o conteúdo. **Já existe:** `lib/whatsapp/media.ts` com os builders de payload (`buildImageMessage`/`buildAudioMessage`/`buildDocumentMessage`/`buildVideoMessage`…) e um padrão de upload ao Supabase Storage (`lib/whatsapp/template-media-preview.ts`, mas em bucket **público** para template). O upload de arquivo pra Meta (`POST /{phone_number_id}/media`) existe solto em `app/api/campaign/workflow/route.ts`.

**Goal:** Inbox estilo WhatsApp Web para **imagem, documento, vídeo e áudio** — enviar (anexar arquivo) e receber, com preview/player/download na conversa. Mídia recebida é baixada da Meta e persistida; mídia enviada é subida à Meta e persistida. Responde sempre pelo número da conversa (Fase 4).

**Fora de escopo (Fase 5B):** gravação de voz no navegador (MediaRecorder) e remux server-side com ffmpeg para nota de voz. Também fora: sticker, localização, reações. Nesta 5A, **áudio recebido toca** na conversa e **áudio enviado é por upload de arquivo** (não gravação).

## Decisões (aprovadas no brainstorm)

- **Escopo 5A:** imagem, documento, vídeo, áudio (arquivo). Gravação de voz = 5B (com ffmpeg).
- **Storage:** bucket **privado** `wa-inbox-media` no Supabase Storage; caminho `{tenant_id}/{conversation_id}/{message_id}.{ext}`. Acesso só via **URL assinada de curta duração** por uma rota server escopada por tenant. Guarda mídia recebida E enviada.
- **Recebimento:** baixar da Meta por `media_id` e persistir; a UI mostra placeholder "recebendo mídia…" e atualiza via realtime quando o arquivo chega.
- **Envio:** centralizar `uploadMediaToMeta` em `lib/whatsapp/media.ts`; estender o envio para tipos de mídia reusando os builders existentes.
- **Limites (validação):** imagem ≤5MB, vídeo ≤16MB, áudio ≤16MB, documento ≤100MB; whitelist de mime types conforme a Meta.

## Global Constraints

- Mídia é **dado privado do cliente**: bucket privado, nunca público; URL sempre assinada e de curta duração (ex.: 5 min); a rota que assina resolve o tenant via `getTenantContext` e valida que a mensagem/mídia é do tenant (nunca serve mídia de outro tenant).
- Envio responde **pelo número da conversa** (`getWhatsAppCredentialsForNumber`, Fase 4), não pelo ativo.
- Não duplicar builders de payload — reusar `lib/whatsapp/media.ts`. Centralizar o upload à Meta (hoje solto na campanha) numa função única e reaproveitá-la na campanha também (sem regressão).
- Baixar mídia da Meta **fora do caminho síncrono do webhook** (a Meta re-tenta se o webhook demora): usar o worker/enqueue assíncrono já existente (QStash / o mesmo ponto onde a resposta da IA é despachada).
- Persistência escopada por tenant (`inbox_messages.tenant_id`), como todo o resto.
- Migração versionada em `supabase/migrations/` E aplicada via MCP (colunas + criação do bucket privado + policies de storage).
- Baseline: `tsc --noEmit` limpo, `npm run build` ok, `npx vitest run` sem regressão.
- Branch: `saas/fase-5a-inbox-midia` a partir de `main`.

## Componentes

### 1. Schema + Storage
- **Migração `<ts>_inbox_media.sql`:**
  - `inbox_messages` ganha: `media_path text`, `media_mime text`, `media_filename text`, `media_size bigint`, `media_duration int` (segundos, áudio/vídeo; nullable), `media_status text default 'ready'` (`pending` enquanto baixa a mídia recebida, `ready` quando disponível, `failed` se o download falhar). O `media_url`/`message_type`/`payload` existentes permanecem.
  - Criar o bucket **privado** `wa-inbox-media` (via SQL `storage.create_bucket` ou `insert into storage.buckets`, `public=false`) — seguindo o padrão do instalador (`lib/installer/migrations.ts`).
  - Policies de `storage.objects` para o bucket: acesso só via service role (as rotas server assinam a URL); `authenticated` não lê direto (o token nunca vai ao client).

### 2. `lib/whatsapp/media.ts` — upload à Meta (centralizar)
- **`uploadMediaToMeta(params: { phoneNumberId, accessToken, bytes: Buffer|Blob, mime, filename? }): Promise<string /* media_id */>`** — `POST https://graph.facebook.com/v24.0/{phoneNumberId}/media` (multipart: `messaging_product=whatsapp`, `type=mime`, `file`). Extrai a lógica hoje inline em `app/api/campaign/workflow/route.ts` e faz a campanha passar a chamar essa função (sem mudar o comportamento).
- **`downloadMetaMedia(params: { mediaId, accessToken }): Promise<{ bytes: Buffer, mime: string, filename?: string, size: number }>`** — dois passos: `GET /{mediaId}` → `{ url, mime_type, file_size }`; depois `GET url` com `Authorization: Bearer token` → bytes.

### 3. `lib/inbox/inbox-media.ts` — persistência de mídia no Storage
- **`storeInboundMedia(params: { tenantId, conversationId, messageId, mediaId, accessToken }): Promise<void>`** — `downloadMetaMedia` → sobe pro bucket `wa-inbox-media` em `{tenantId}/{conversationId}/{messageId}.{ext}` → atualiza a mensagem (`media_path`, `media_mime`, `media_filename`, `media_size`, `media_status='ready'`). Em erro, `media_status='failed'` (fail-safe, não relança para não travar o worker).
- **`storeOutboundMedia(params: { tenantId, conversationId, messageId, bytes, mime, filename }): Promise<string /* media_path */>`** — sobe o arquivo enviado pro mesmo bucket e devolve o `media_path` (para persistir na mensagem outbound).
- **`getSignedMediaUrl(tenantId, messageId): Promise<string | null>`** — valida que a mensagem é do tenant, gera signed URL curta (ex.: 300s) do `media_path`. `null` se não for do tenant ou não houver mídia.

### 4. Recebimento (inbound)
- **Webhook (`app/api/webhook/route.ts` / `lib/inbox/inbox-webhook.ts`):** corrigir o parsing — para `image/audio/video/document/sticker`, extrair `message.<type>.id` (media_id), `mime_type`, `filename` (documento), NÃO `.url`. Persistir a mensagem com `message_type` correto e `media_status='pending'`.
- **Download assíncrono:** logo após persistir, **enfileirar** (QStash, `@upstash/qstash`, mesmo padrão do repo) um job `POST /api/inbox/media/ingest` `{ tenantId, conversationId, messageId, mediaId }` que chama `storeInboundMedia`. A rota verifica a assinatura QStash (`Receiver`) e resolve as credenciais do número da conversa. Quando conclui, o realtime já existente do inbox propaga a atualização (a UI troca o placeholder pelo conteúdo).
- Legenda: `message.<type>.caption` (quando houver) vira o `content`/preview da mensagem.

### 5. Envio (outbound)
- **Rota `POST /api/inbox/conversations/[id]/media`** (multipart): recebe o arquivo + legenda opcional. `getTenantContext` → 401; valida tipo/tamanho (limites da Meta). Fluxo: resolve o número da conversa (`getWhatsAppCredentialsForNumber`) → `uploadMediaToMeta` (media_id) → `buildImageMessage`/`buildAudioMessage`/`buildVideoMessage`/`buildDocumentMessage` conforme o tipo → envia via WhatsApp (estender `sendWhatsAppMessage` ou novo `sendWhatsAppMedia` que aceita esses payloads) → `storeOutboundMedia` (persistir o arquivo) → grava a mensagem outbound (`direction='outbound'`, `message_type`, `media_path`, `media_mime`, `media_filename`, `media_size`, `media_status='ready'`).
- **`lib/whatsapp-send.ts`:** estender `WhatsAppMessage.type` para `'image'|'audio'|'video'|'document'` e montar o corpo a partir dos builders de `media.ts` (que já produzem o payload correto). Não alterar text/template/reaction/interactive.

### 6. Rota de leitura de mídia
- **`GET /api/inbox/media/[messageId]`** — `getTenantContext` → 401; `getSignedMediaUrl(tenantId, messageId)`; 302 redirect para a signed URL (ou 404 se não for do tenant / mídia ausente). Usada pela UI para `<img src>`, `<audio src>`, `<video src>`, download de documento.

### 7. UI
- **`MessageInput.tsx`:** botão de anexo (📎) → seletor de arquivo (`accept` por tipo) com **preview** (imagem/vídeo) + campo de legenda + enviar/cancelar. Estados de upload (enviando…). `onSend` ganha uma variante para anexos (ou um novo `onSendMedia(file, caption)`), sem quebrar o envio de texto. (Sem microfone nesta fatia — 5B.)
- **`MessageBubble.tsx`:** renderizar de verdade por `message_type`: imagem (thumb clicável → lightbox), vídeo (`<video controls>`), áudio (`<audio controls>` + duração), documento (ícone + nome + tamanho + botão de download). Enquanto `media_status='pending'`, placeholder "recebendo mídia…"; `failed` → aviso "mídia indisponível". A `src` aponta para `GET /api/inbox/media/[messageId]`.

## Data Flow
```
RECEBER: webhook → parse media_id (não url) → persiste msg (media_status=pending)
        → enfileira QStash → /api/inbox/media/ingest → downloadMetaMedia → Storage
        → update msg (media_path, ready) → realtime → UI troca placeholder por conteúdo
ENVIAR:  UI anexa arquivo → POST /conversations/[id]/media → uploadMediaToMeta (media_id)
        → buildXMessage → sendWhatsAppMedia (número da conversa) → storeOutboundMedia
        → persiste msg outbound (ready) → realtime → bolha com a mídia
LER:     UI <img/audio/video src=/api/inbox/media/[messageId]> → signed URL curta → arquivo
```

## Error Handling
- Download da mídia recebida falha → `media_status='failed'`, UI mostra "mídia indisponível"; não trava o worker nem a conversa. Job QStash pode re-tentar (política padrão).
- Envio: arquivo acima do limite/tipo inválido → 400 antes de qualquer upload. Falha no upload à Meta ou no envio → 502, mensagem não é persistida como enviada (ou marcada `failed`), UI mostra erro e permite reenviar.
- Rota de leitura: mensagem de outro tenant ou sem mídia → 404 (nunca vaza). Signed URL sempre curta.

## Testing
- `lib/whatsapp/media.test.ts` (já existe): `uploadMediaToMeta` (multipart correto, retorna media_id), `downloadMetaMedia` (2 passos, mime/size). Builders já testados.
- `lib/inbox/inbox-media.test.ts`: `storeInboundMedia` (download→upload→update ready; erro→failed), `getSignedMediaUrl` (escopo por tenant → null p/ outro tenant), `storeOutboundMedia` (caminho e retorno).
- Rota `/api/inbox/media/ingest`: verifica assinatura QStash; chama `storeInboundMedia`.
- Rota `POST /conversations/[id]/media`: 401 sem sessão; 400 tipo/tamanho inválido; sucesso → uploadMetaMedia + send + persiste.
- Rota `GET /api/inbox/media/[messageId]`: 401 sem sessão; 404 mídia de outro tenant; 302 com signed URL.
- Webhook: parsing de `image/audio/video/document` extrai `media_id` (não url) e persiste `pending`.
- Regressão: campanha continua enviando mídia após centralizar `uploadMediaToMeta`. Suíte verde, `tsc`/`build` limpos.

## Rollback
Reverter os commits. Colunas novas em `inbox_messages` são nullable/inertes; o bucket pode permanecer. Sem alteração destrutiva. O parsing antigo (errado) do webhook é substituído — reverter volta ao comportamento anterior (mídia recebida não exibível), sem quebrar texto.
