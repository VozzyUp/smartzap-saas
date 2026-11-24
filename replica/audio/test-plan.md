# Plano de testes: áudio recebido (transcrição, inbox) e cartão do funil

Legenda: A = automatizado (arquivo), M = manual (nada aqui chama Meta, OpenAI, Gemini, QStash ou banco reais).

## F16 Áudio, transcrição, IA responde
| Caso | Tipo | Onde |
|---|---|---|
| Feliz (OpenAI): chave openai_api_key, modelo gpt-4o-mini-transcribe, language pt, arquivo audio.ogg, texto devolvido sem espaços | A | lib/ai/transcription.test.ts |
| Feliz (Gemini): só chave Google, generateContent com inline_data, chave no header (não na URL) | A | idem |
| Prioridade: com as duas chaves usa OpenAI | A | idem |
| Mime `audio/ogg; codecs=opus` vira `audio/ogg` + `audio.ogg` | A | idem (normalizeAudioMime) |
| Modelo novo inexistente: tenta whisper-1 | A | idem |
| Sem nenhuma chave: `no_provider`, sem chamar a rede (conta só com Anthropic cai aqui) | A | idem |
| Erro HTTP, texto vazio, timeout (AbortError), áudio acima de 25 MB, falha ao ler settings: devolve `{ error }`, nunca lança, sem vazar chave | A | idem |
| Integração: transcreve áudio recebido sem marca, grava `payload.transcription` filtrando tenant_id + id, devolve a mensagem atualizada | A | lib/inbox/inbox-transcription.test.ts |
| Idempotência: com `transcription` ou `transcription_error` não baixa nem transcreve de novo | A | idem |
| Ignora texto, áudio enviado por nós e áudio com legenda | A | idem |
| Falhas (sem media_id, sem credencial, download, provedor): grava `transcription_error` e segue | A | idem |
| /api/ai/respond chama a transcrição antes de processChatAgent e entrega as mensagens atualizadas | A | app/api/ai/respond/route.test.ts (F16) |
| Exceção na transcrição não impede a IA de responder | A | idem |
| `[Áudio transcrito] texto` para o modelo; sem transcrição cai em "não pôde ser lido"; só vale para áudio recebido | A | lib/ai/agents/describe-message.test.ts |
| Webhook grava `media_id` no payload (RPC) só quando há mídia | A | lib/inbox/inbox-webhook.test.ts |
| Ponta a ponta real: áudio de voz do WhatsApp, IA responde coerente com o que foi dito | M | exige Meta, OpenAI/Gemini, QStash |
| Áudio de 1 a 2 minutos: tempo total até a resposta aceitável | M | |
| Duas mensagens de áudio seguidas (debounce): ambas transcritas, uma resposta | M | |
| Conta só com Anthropic (sem chave OpenAI/Google): IA responde com "não pôde ser lido" e há aviso ao dono | M | aviso ainda não existe (ver V-03) |

## F17 Áudio visível no inbox
| Caso | Tipo | Onde |
|---|---|---|
| Painel do dono: player com src `/api/inbox/media/{id}` e transcrição com rótulo "Transcrição" | A | components/features/inbox/MessageBubble.audio.test.tsx |
| Sem transcrição: só o player | A | idem |
| Mídia pendente: sem player | A | idem |
| Componente de transcrição: vazio/erro/formato inesperado não renderiza | A | components/features/inbox/AudioTranscription.test.tsx |
| Tela do atendente (`app/atendimento`): player + transcrição | M | página sem teste de componente; mudança em app/atendimento/conversa/[id]/page.tsx |
| Rota de mídia usa sessão e filtra tenant | A | app/api/inbox/media/[messageId]/route.test.ts (já existia) |
| Reprodução real de ogg/opus no Chrome, Firefox, Safari/iOS | M | ver V-01 |
| Imagem e vídeo recebidos: painel mostra (MessageBubble); atendente não mostra | M | ver V-04 |

## F18 Apagar conversa apaga cartão do funil
| Caso | Tipo | Onde |
|---|---|---|
| Feliz: apaga conversa e cartões do contato, tudo com tenant_id | A | lib/inbox/inbox-service.delete.test.ts, lib/kanban-contact-cards.test.ts |
| Vários cartões (vários quadros): todos saem | A | lib/kanban-contact-cards.test.ts |
| Conversa sem contact_id: resolve contato pelo telefone no mesmo tenant | A | inbox-service.delete.test.ts |
| Sem contato resolvível: só a conversa | A | idem |
| Falha ao apagar cartão: loga, conversa já apagada, resposta de sucesso | A | idem |
| Falha ao ler a conversa antes: ainda apaga a conversa | A | idem |
| Falha ao apagar a conversa: cartão preservado, erro sobe | A | idem |
| Fechar conversa não toca no cartão | A | idem (patchConversation) |
| Contato sem cartão: 0 apagados | A | lib/kanban-contact-cards.test.ts |
| Erro ao listar cartões é propagado (e logado por quem chama) | A | idem |
| Filhos `kanban_card_automation_log`: ON DELETE CASCADE | M | supabase/migrations/20260725000001_kanban_automation.sql:56 (lido, não testado em banco) |
| Isolamento: apagar conversa do tenant A não apaga cartão do tenant B | A | filtros tenant_id verificados nos testes acima; M no banco real |
| Recomeçar a conversa depois de apagar: cartão novo na fase inicial | M | |
| Contato com duas conversas e uma apagada: cartão some mesmo assim | M | ver V-05 |
