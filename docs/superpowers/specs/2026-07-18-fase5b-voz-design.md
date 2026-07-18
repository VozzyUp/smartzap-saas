# Fase 5B — Nota de voz no inbox (gravar no navegador + remux ffmpeg) — Design

**Contexto:** A Fase 5A entregou mídia no inbox (imagem/documento/vídeo/áudio por arquivo), com o pipeline de envio `POST /api/inbox/conversations/[id]/media` (multipart → `uploadMediaToMeta` → `sendWhatsAppMedia` pelo número da conversa → persiste no Storage privado). Falta a **nota de voz gravada no navegador**, que foi deixada para esta fatia porque exige remux server-side. O WhatsApp renderiza como nota de voz (PTT) quando o áudio é **Opus em contêiner OGG** (`audio/ogg`); o Chrome grava `audio/webm;codecs=opus` (contêiner diferente), então precisa remux. O container é `node:22-alpine` (Dockerfile) e **não tem ffmpeg**.

**Goal:** Gravar voz no `MessageInput` (tap grava / tap para → revisa → envia), converter para `audio/ogg` (Opus) no servidor com ffmpeg e enviar como nota de voz pelo número da conversa, reusando todo o pipeline da 5A. Fail-safe: se o ffmpeg falhar/ausente, envia o áudio original (áudio comum, não PTT) — nunca perde a mensagem.

**Fora de escopo:** transcrição de áudio, formas de onda (waveform) elaboradas, edição do áudio, hold-to-talk.

## Decisões (aprovadas no brainstorm)

- **ffmpeg via sistema:** `apk add --no-cache ffmpeg` no stage `runner` do Dockerfile; chamado por `child_process.spawn('ffmpeg', …)`. NÃO usar `ffmpeg-static`/`@ffmpeg-installer` (binário glibc não roda em Alpine/musl).
- **Gravação:** `MediaRecorder`, preferindo `audio/ogg;codecs=opus` (Firefox) senão `audio/webm;codecs=opus` (Chrome). Envia blob + mime + `voice=true`.
- **Remux:** `remuxToOggOpus` via ffmpeg em pipes (stdin→stdout, sem disco). Se já for `audio/ogg`, pula. Fail-safe (ffmpeg ausente/erro → envia original).
- **Envio:** estende a rota 5A com o caminho de voz; reusa `uploadMediaToMeta`/`sendWhatsAppMedia`/persistência.
- **UX:** tap grava / tap para → preview (ouvir) → Enviar/Cancelar (WhatsApp Web desktop).

## Global Constraints

- Reusar o pipeline de envio/persistência da 5A (`POST /api/inbox/conversations/[id]/media`, `uploadMediaToMeta`, `sendWhatsAppMedia`, `storeOutboundMedia`) — não duplicar. A voz é uma variação do envio de áudio.
- Envio responde **pelo número da conversa** (`getWhatsAppCredentialsForNumber`, Fase 4).
- Remux roda **em memória via pipes** (sem escrever arquivos temporários no container).
- Fail-safe: nenhuma falha de remux/ffmpeg pode perder a mensagem nem derrubar a rota; degrada para áudio comum.
- Limite de tamanho/duração de áudio da Meta (≤16MB) continua valendo; validar antes do upload.
- `access_token` nunca vai ao client; a UI usa a rota de mídia da 5A para tocar o áudio.
- Baseline: `tsc --noEmit` limpo, `npm run build` ok (sem exigir ffmpeg no build — ele é runtime), `npx vitest run` sem regressão.
- Branch: `saas/fase-5b-voz` a partir de `main` (com a 5A já mergeada).

## Componentes

### 1. Dockerfile — ffmpeg no runtime
- No stage `runner` (antes de `USER nextjs`, precisa de root): `RUN apk add --no-cache ffmpeg`. Não afeta o build do Next (o ffmpeg é usado só em runtime, no envio de voz).

### 2. `lib/audio/voice-remux.ts` — conversão para OGG/Opus
- **`remuxToOggOpus(input: Buffer, inputMime: string): Promise<{ buffer: Buffer; mime: string; remuxed: boolean }>`**
  - Se `inputMime` começa com `audio/ogg` → retorna `{ buffer, mime: 'audio/ogg', remuxed: false }` (sem tocar).
  - Senão, roda `ffmpeg -hide_banner -loglevel error -i pipe:0 -c:a libopus -f ogg pipe:1` (via `spawn`, escrevendo `input` no stdin, lendo o stdout). Sucesso → `{ buffer: out, mime: 'audio/ogg', remuxed: true }`.
  - **Fail-safe:** ffmpeg ausente (ENOENT), exit ≠ 0, ou timeout (ex.: 15s) → retorna `{ buffer: input, mime: inputMime, remuxed: false }` (não lança). Loga o motivo.
  - `isFfmpegAvailable(): Promise<boolean>` (opcional, `spawn('ffmpeg', ['-version'])`) — útil para o health/log.

### 3. Envio — caminho de voz na rota 5A
- **`POST /api/inbox/conversations/[id]/media`** ganha o campo `voice` no multipart (`'true'`/ausente). Quando `voice==='true'` e o mime é de áudio:
  - `remuxToOggOpus(buffer, mime)` → usa o resultado (`audio/ogg` se remuxou; original se degradou).
  - Segue o fluxo 5A: `uploadMediaToMeta({ …, contentType: resultMime, filename: 'voice.ogg' })` → `sendWhatsAppMedia` tipo `audio` → persiste (message_type='audio'; `media_mime` = resultMime). Como o áudio final é `audio/ogg`/opus, a Meta renderiza como nota de voz.
  - Validação de tamanho (≤16MB) aplicada ao buffer final.
- Sem `voice`, o comportamento da 5A (áudio por arquivo) é inalterado.

### 4. UI — gravação no `MessageInput`
- Botão de **microfone** (🎤) ao lado do anexo. Ao clicar: `navigator.mediaDevices.getUserMedia({ audio: true })` (trata negação de permissão com toast). Inicia `MediaRecorder` no melhor mime suportado (`audio/ogg;codecs=opus` → `audio/webm;codecs=opus` → default).
- Durante a gravação: **timer** (mm:ss), botão **parar** e **cancelar** (descarta + `stream.getTracks().forEach(t=>t.stop())`).
- Ao parar: monta o `Blob`, mostra um **preview** (`<audio controls>` do objectURL) com **Enviar** / **Cancelar (descartar)**.
- Enviar: `FormData` com `file` (o blob, filename `voice.ogg`/`voice.webm`), `voice='true'`, `POST` para a conversa atual. Estado "enviando…". Sucesso → limpa; a bolha aparece via realtime (renderizada como áudio pela 5A). Erro → toast.
- Revogar objectURL e parar tracks ao cancelar/enviar/desmontar (sem leak de mic/URL).
- Não quebrar o envio de texto (5A) nem o anexo de arquivo (5A).

## Data Flow
```
🎤 grava (MediaRecorder ogg/webm opus) → preview → Enviar
  → POST /conversations/[id]/media (file + voice=true)
  → remuxToOggOpus (webm→ogg opus; ou pula se já ogg; ou degrada se ffmpeg falhar)
  → uploadMediaToMeta (audio/ogg) → sendWhatsAppMedia(audio) pelo número da conversa
  → storeOutboundMedia + persiste (message_type='audio') → realtime → bolha com player
```

## Error Handling
- Permissão de mic negada → toast, não grava.
- ffmpeg ausente/erro/timeout → degrada para o áudio original (áudio comum), mensagem enviada mesmo assim; loga.
- Áudio final acima de 16MB → 400 antes do upload.
- Falha no envio à Meta → 502, UI mostra erro e permite regravar.

## Testing
- `lib/audio/voice-remux.test.ts`: `remuxToOggOpus` — já ogg → pula (remuxed:false); webm → chama spawn com os args certos e retorna o stdout como buffer ogg (mock de `child_process.spawn`); ffmpeg ENOENT/exit≠0 → degrada para input original sem lançar.
- Rota `POST /conversations/[id]/media` com `voice='true'`: chama `remuxToOggOpus` e envia com `audio/ogg` (mock remux + uploadMediaToMeta + send); sem `voice`: caminho 5A inalterado (regressão).
- UI sem teste automatizado (padrão do repo); `tsc`/`build` limpos. Build não exige ffmpeg.
- Sem regressão na suíte.

## Rollback
Reverter os commits. O `apk add ffmpeg` no Dockerfile é aditivo (só aumenta a imagem). Sem ffmpeg, o caminho de voz degrada para áudio comum. Nenhuma alteração de schema (reusa as colunas da 5A). Nada destrutivo.
