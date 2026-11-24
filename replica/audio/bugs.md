# Bugs e achados: áudio recebido e cartão do funil

## Corrigidos neste trabalho
| ID | Sev | Resumo | Evidência | Commit |
|---|---|---|---|---|
| B-01 | S2 | IA nunca entendia áudio: recebia só "[O contato enviou um áudio e o conteúdo não pôde ser lido]" e respondia no escuro | lib/ai/agents/chat-agent.ts:293 (describeMessageForAI), não havia transcrição | fb9e7a1, fd5b2ae, d3cc18b |
| B-02 | S2 | Tela do atendente (`app/atendimento`) não mostrava player de áudio nem mídia nenhuma, só o texto (vazio) | app/atendimento/conversa/[id]/page.tsx (bolha local só com `content`) | 815a352 |
| B-03 | S3 | Apagar a conversa deixava o cartão no funil, na mesma fase; ao recomeçar a conversa o cartão antigo reaparecia | lib/inbox/inbox-db.ts:361 removeConversation não tocava em kanban_cards | 1de7915 |
| B-04 | S3 | Payload da mensagem recebida não guardava o media_id da Meta; só o job de download o recebia, então nada além dele conseguia baixar o áudio | lib/inbox/inbox-webhook.ts (p_payload) | 767462a |

## A verificar (suspeitas não reproduzidas)
| ID | Sev | Suspeita | Evidência |
|---|---|---|---|
| V-01 | S2 | Safari/iOS não toca ogg/opus em `<audio>`: o player pode ficar mudo no iPhone. Possível solução: converter para mp3/m4a no ingest | components/features/inbox/MessageBubble.tsx (audio, `<source>` sem type) |
| V-02 | S3 | Tempo de resposta: a transcrição (até 45 s por áudio, até 5 em paralelo) soma ao debounce antes da resposta. maxDuration da rota é 300 s, então cabe, mas o lead espera mais | app/api/ai/respond/route.ts:33 e :199 |
| V-03 | S2 | Conta só com Anthropic (sem chave OpenAI nem Google) nunca transcreve e não há aviso ao dono; a falha fica só em `payload.transcription_error` | lib/ai/transcription.ts (`no_provider`) |
| V-04 | S3 | Tela do atendente também não mostra imagem, vídeo e documento recebidos (só áudio foi corrigido). A IA recebe "[O contato enviou uma imagem] legenda" sem ver a imagem | app/atendimento/conversa/[id]/page.tsx; chat-agent.ts MEDIA_LABEL |
| V-05 | S3 | Apagar uma conversa apaga o cartão do contato mesmo que ele tenha outra conversa (outro número da conta) | lib/inbox/inbox-service.ts deleteConversation |
| V-06 | S4 | Mensagens recebidas antes deste deploy não têm `media_id` no payload: se ainda estiverem sem resposta, caem em "não pôde ser lido" (`no_media_id`) | lib/inbox/inbox-transcription.ts |
| V-07 | S4 | Gravação do payload é leitura-modifica-escrita do JSON inteiro; escrita concorrente no mesmo payload seria sobrescrita (hoje só este código altera o payload de mensagem recebida) | lib/inbox/inbox-transcription.ts savePayload |
| V-08 | S4 | `last_message_preview` da conversa para áudio não usa a transcrição (a RPC define o texto; não alterado para evitar migração) | supabase/migrations/20260719000001_process_inbound_message_whatsapp_number_id.sql:59 |
| V-09 | S4 | Qualquer 404 da OpenAI aciona o modelo de reserva whisper-1 (mesmo que o 404 não seja de modelo) | lib/ai/transcription.ts isModelMissing |
