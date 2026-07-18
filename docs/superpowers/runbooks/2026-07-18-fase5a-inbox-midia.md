# Runbook — Fase 5A: Inbox com mídia (imagem/documento/vídeo/áudio)

## O que foi entregue
- Inbox estilo WhatsApp Web para **imagem, documento, vídeo e áudio** — **enviar** (anexar arquivo com preview + legenda) e **receber** (preview/player/download na bolha).
- Envio responde **pelo número da conversa** (Fase 4). Mídia recebida é baixada da Meta e persistida; mídia enviada é subida à Meta e persistida.
- **Correção importante:** o parsing de mídia recebida estava errado (lia `message.image.url`, que a Meta não envia — ela manda `media_id`). Antes desta fase, nenhuma mídia recebida era exibível. Agora funciona.

**Fora de escopo (Fase 5B):** gravação de voz no navegador + remux ffmpeg para nota de voz. Nesta 5A, áudio recebido toca e áudio enviado é por upload de arquivo.

## Arquitetura (resumo)
- **Storage:** bucket **privado** `wa-inbox-media`; caminho `{tenant_id}/{conversation_id}/{message_id}.{ext}`. Acesso só via **URL assinada curta** (300s) por `GET /api/inbox/media/[messageId]` (escopada por tenant). O token da Meta nunca vai ao client.
- **Receber:** webhook parseia `media_id` e persiste a mensagem com `media_status='pending'` → enfileira via **QStash** `POST /api/inbox/media/ingest` → baixa da Meta (`downloadMetaMedia`) → sobe pro Storage → `media_status='ready'` → realtime troca o placeholder pelo conteúdo. Fallback em dev sem `QSTASH_TOKEN`: ingest inline.
- **Enviar:** `POST /api/inbox/conversations/[id]/media` (multipart) → valida tipo/tamanho → `uploadMediaToMeta` (media_id) → `sendWhatsAppMedia` (builders de `lib/whatsapp/media.ts`) → `storeOutboundMedia` → persiste a mensagem outbound.
- **Schema:** `inbox_messages` ganhou `media_path`, `media_mime`, `media_filename`, `media_size`, `media_duration`, `media_status` (CHECK ready/pending/failed).
- Centralizado `uploadMediaToMeta`/`downloadMetaMedia` em `lib/whatsapp/media.ts`; a **campanha** passou a reusar `uploadMediaToMeta` (sem regressão — só consome `.ok`/`.id`).

## Migração aplicada (via MCP)
- `20260720000001_inbox_media.sql` — colunas `media_*` + bucket privado `wa-inbox-media`. Verificado: 6 colunas, `public=false`.

## Infra / variáveis de ambiente (IMPORTANTE)
- **QStash de recebimento de jobs** exige `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY` no ambiente de **runtime** (a rota `/api/inbox/media/ingest` valida a assinatura com elas). Sem elas, os jobs de download de mídia recebida serão rejeitados (401) — o resto do inbox segue funcionando. Já constam no `.env.example`.
- O build **não** precisa dessas envs (o verificador é construído no request, não no import) — o `next build` do CI passa sem elas. Confirmado.
- Bucket `wa-inbox-media` é criado pela migração (privado). Nada a configurar manualmente no Supabase.

## Smoke test (pós-deploy)
1. **Receber**: mande do WhatsApp para o número do tenant uma imagem, um áudio, um PDF e um vídeo. Cada um aparece na conversa: primeiro "Recebendo mídia…", depois o conteúdo (imagem/preview, player de áudio/vídeo, card de documento com download). Legenda aparece abaixo quando houver.
2. **Enviar**: no inbox, 📎 → escolher imagem/vídeo/áudio/documento → preview + legenda → Enviar. Chega no WhatsApp do cliente **pelo número da conversa**. A bolha aparece via realtime.
3. **Limites**: tentar enviar um arquivo acima do limite (ex.: documento >100MB) → erro amigável, nada é enviado.
4. **Isolamento**: `GET /api/inbox/media/[messageId]` de uma mensagem de outro tenant → 404 (nunca serve).
5. **Regressão**: enviar uma campanha com mídia de header → continua funcionando (o `uploadMediaToMeta` centralizado).

## Rollback
Reverter os commits. As colunas `media_*` são nullable/inertes; o bucket pode permanecer. Sem alteração destrutiva. Reverter o parsing volta ao comportamento anterior (mídia recebida não exibível), sem quebrar texto.

## Próximo (Fase 5B)
Gravação de voz no navegador (MediaRecorder) + remux server-side com ffmpeg (webm/opus → ogg/opus) para nota de voz idêntica em qualquer navegador — decisão já tomada de usar ffmpeg.
