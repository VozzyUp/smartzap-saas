# Plano de testes (replica) — IA no funil, opt-out e aviso de handoff

Legenda: H = caminho feliz, E = borda, N = negativo. "Auto" = automatizado (arquivo de teste); "Manual" = precisa de ambiente real (modelo de IA real, WhatsApp, banco) e NÃO foi executado nesta rodada.

Arquivos de teste:
- T1 `lib/opt-out-keywords.test.ts`
- T2 `lib/ai/funnel-classifier.test.ts`
- T3 `lib/ai/agents/chat-agent-funnel-optout.test.ts`
- T4 `lib/push-notifications.handoff.test.ts`
- T5 `app/api/ai/respond/route.test.ts`
- T6 `lib/ai/anthropic-support.test.ts`
- T7 `lib/ai/agents/chat-agent-anthropic.test.ts`
- T8 `lib/ai/agents/chat-agent-anthropic-schema.test.ts`
- T9 `lib/ai/ai-center-config.test.ts` (bloco "provedor Anthropic")
- T10 `app/api/settings/ai/route.anthropic.test.ts`
- T11 `app/api/ai/models/route.anthropic.test.ts`
- T12 `lib/ai/llm-model.test.ts`
- T13 `lib/ai/unified-ai-service-anthropic.test.ts`

## F01 — Lead responde e a IA classifica no funil

| ID | Tipo | Caso | Cobertura |
|----|------|------|-----------|
| F01-H1 | H | Tenant com 1 quadro, sem card: IA devolve fase "Negociação" -> card criado já nessa fase | Auto T2 (applyFunnelClassification), T5 (rota chama apply) |
| F01-H2 | H | Card existente em outra fase: IA devolve outra fase -> card movido, tag `funil/...` espelhada por moveCard | Auto T2 (move); espelho da tag: Manual (syncStageTag é de lib/kanban.ts, já testado em lib/kanban.test.ts) |
| F01-H3 | H | IA volta o lead para fase anterior | Auto T2 |
| F01-H4 | H | Prompt de sistema contém as fases, fase atual e instrução | Auto T2 (buildFunnelPromptSection), T5 (funnel passado ao agente) |
| F01-H5 | H | Setting `ai_funnel_board_id` escolhe quadro entre vários, filtrando por tenant_id | Auto T2 |
| F01-H6 | H | IA decide com modelo real a partir de conversa real | Manual |
| F01-H7 | H | Automação message_sent + IA na mesma rodada: IA prevalece | Auto T5 (ordem automação -> funil) |
| F01-E1 | E | Mensagem vazia / só emoji (modelo devolve null) -> não muda | Auto T2 (null/vazio), T5 (funnelStage null) |
| F01-E2 | E | Texto muito longo / emoji e acentos: nome da fase casa ignorando caixa/acento | Auto T2; texto longo com modelo real: Manual |
| F01-E3 | E | Duas mensagens seguidas (debounce/dedup) | Manual (lógica de dedup/debounce não foi alterada) |
| F01-E4 | E | Tenant sem quadro -> não classifica | Auto T2, T5 |
| F01-E5 | E | Tenant com dois quadros sem setting -> não classifica | Auto T2 |
| F01-E6 | E | Setting aponta para quadro inexistente / quadro sem fases -> não classifica | Auto T2 |
| F01-E7 | E | Fase inexistente devolvida pelo modelo -> ignorada (enum rejeita; apply ignora) | Auto T2 (invalid_stage), T3 (schema rejeita) |
| F01-E8 | E | Card com `automation_paused` -> não move | Auto T2 |
| F01-E9 | E | Contato inexistente (conversa sem contact_id) -> não classifica | Auto T2 (contactId nulo) |
| F01-E10 | E | Mesma fase que a atual -> nada acontece | Auto T2 |
| F01-E11 | E | Corrida: card criado entre leitura e criação (`card_exists`) -> unchanged | Auto parcial T2 (mapeado por código; sem teste dedicado) |
| F01-N1 | N | Falha do kanban (moveCard/addCard lançam) -> captura, console.error, resposta segue | Auto T2 (retorna `error`), T5 (rota segue) |
| F01-N2 | N | Falha ao listar quadros/fases -> sem classificação, resposta segue | Auto T2 |
| F01-N3 | N | Modelo não suporta campo/enum e a chamada falha | Manual |

## F02 — Pedido de parar

| ID | Tipo | Caso | Cobertura |
|----|------|------|-----------|
| F02-H1 | H | "PARAR de receber" no webhook -> opt-out por palavra-chave | Auto T1 (função); gravação no webhook: Manual (rota inalterada além do import) |
| F02-H2 | H | IA devolve optOut=true -> supressão `ai_detected` gravada e despedida enviada | Auto T5 |
| F02-H3 | H | Telefone já suprimido -> bot não responde, retorna `skipped: phone_suppressed` | Auto T5 |
| F02-H4 | H | Mensagem de quem pediu para parar continua aparecendo no inbox | Manual (webhook grava antes; rota de IA não altera inbox) |
| F02-E1 | E | "parece interessante", "comparar", "aparecer", "removedor" NÃO são opt-out | Auto T1 |
| F02-E2 | E | "parar", "pare", "Parar de receber", "sair", "stop", "não quero mais", "não tenho interesse", "sem interesse", "nao receber" SÃO opt-out | Auto T1 |
| F02-E3 | E | Mensagem vazia / só espaços / só emoji | Auto T1 |
| F02-E4 | E | Texto muito longo sem e com palavra-chave | Auto T1 |
| F02-E5 | E | Acentos e caixa (NÃO TENHO INTERESSE) | Auto T1 |
| F02-E6 | E | Telefone com e sem "+" (formato divergente entre conversa e supressão) | Auto T5 (consulta os dois formatos) |
| F02-E7 | E | Duas mensagens seguidas, a segunda "parar" durante o processamento da primeira | Manual (corrida webhook x worker; ver "a verificar") |
| F02-E8 | E | Contato inexistente (sem contact_id): supressão é por telefone, funciona | Auto T5 parcial |
| F02-E9 | E | Frases ambíguas ("não quero pagar frete") ainda contam como opt-out por keyword | Documentado (comportamento herdado); IA decide o caso fino |
| F02-N1 | N | Falha ao gravar supressão do optOut da IA -> console.error, despedida enviada | Auto T5 |
| F02-N2 | N | Falha ao consultar supressão em /api/ai/respond -> 500 (QStash repete), nada é enviado | Auto T5 |
| F02-N3 | N | Falha ao gravar supressão no webhook (best-effort, já existente) | Manual |

## F03 — Transferência para humano com aviso

| ID | Tipo | Caso | Cobertura |
|----|------|------|-----------|
| F03-H1 | H | IA devolve shouldHandoff -> conversa vira `human` e push disparado ao tenant | Auto T5 |
| F03-H2 | H | Erro da IA -> auto-handoff + push | Auto T5 |
| F03-H3 | H | Push chega ao celular do dono | Manual (VAPID + service worker reais) |
| F03-H4 | H | Push só para subscriptions do tenant (filtro tenant_id) | Auto T4 |
| F03-E1 | E | Tenant sem subscriptions -> 0 enviados, sem erro | Auto T4 |
| F03-E2 | E | Contato sem nome -> usa o telefone como rótulo | Auto T5 parcial (rótulo = nome quando existe) |
| F03-E3 | E | Handoff sem motivo | Auto T4 (reason opcional) |
| F03-E4 | E | VAPID não configurado | Auto parcial (retorna 0/0; sem teste dedicado) |
| F03-E5 | E | Duas mensagens seguidas gerando dois handoffs | Manual (tag do push `handoff-<conversa>` colapsa no dispositivo) |
| F03-N1 | N | Falha do push (web-push lança / banco falha) -> só loga, handoff continua | Auto T4, T5 |
| F03-N2 | N | Subscription expirada (410) -> remoção usa client de sessão e pode falhar no worker | Manual / "a verificar" |

## F04 — Agente respondendo com a Anthropic (Claude)

Restrições dos modelos claude-opus-5-5 / claude-sonnet-5-5 / claude-haiku-5-5 que causam HTTP 400: `temperature`/`topP`/`topK` não padrão e `toolChoice` forçado. O raciocínio (thinking) é sempre ligado e consome `max_tokens`. Nenhum caso abaixo foi executado contra a API real (sem chave).

| ID | Tipo | Caso | Cobertura |
|----|------|------|-----------|
| F04-H1 | H | Conta com provedor anthropic e chave: o agente cria o modelo com `createAnthropic({ apiKey })` e responde chamando a tool `respond` | Auto T7 |
| F04-H2 | H | A chamada NÃO leva `temperature`, `topP`, `topK` nem `providerOptions` (thinking); usa `toolChoice: 'auto'` | Auto T6, T7, T13 |
| F04-H3 | H | Prompt de sistema recebe a instrução de responder pela tool `respond` | Auto T6, T7 |
| F04-H4 | H | Salvar chave Anthropic na tela: valida com GET /v1/models (sem gerar tokens), grava `anthropic_api_key` do tenant | Auto T10 (rota); clique na tela: Manual |
| F04-H5 | H | Escolher Anthropic grava `ai_direct` com `claude-opus-5-5`; lista de modelos traz os 3 ids exatos | Auto T9, T10, T11 |
| F04-H6 | H | GET da configuração devolve só `tokenPreview` mascarado, nunca a chave | Auto T10 |
| F04-H7 | H | Resposta real do Claude com a tool `respond` (schema com `funnelStage` enum anulável e `optOut`) | Manual (precisa de chave real) |
| F04-H8 | H | Busca na base de conhecimento com provedor Anthropic: tool `searchKnowledgeBase` presente e embeddings seguem o provedor do agente (Google/OpenAI), não a Anthropic | Auto T7 (mock); busca real: Manual |
| F04-E1 | E | Chave Anthropic ausente (provedor anthropic, só outra chave configurada) -> erro "Chave Anthropic não configurada", sem chamar IA | Auto T7, T12, T13 |
| F04-E2 | E | Nenhuma chave -> mensagem genérica existente | Auto T7 |
| F04-E3 | E | Chave inválida na tela (401) -> 400 com mensagem, nada é salvo | Auto T6, T10 |
| F04-E4 | E | Modelo desconhecido/de outro provedor no agente (ex.: `gemini-2.5-flash`) -> cai em `claude-opus-5-5`; id `claude-*` novo é respeitado | Auto T6, T7, T9, T12 |
| F04-E5 | E | Temperatura configurada no agente (0.3) é ignorada para a Anthropic e continua valendo para Google/OpenAI | Auto T7 |
| F04-E6 | E | `max_tokens` do agente abaixo de 2000 sobe para 2000 (raciocínio consome o limite); acima é mantido; Google/OpenAI inalterados | Auto T6, T7, T13 |
| F04-E7 | E | Modelo responde em texto sem chamar a tool -> o texto vira a mensagem (sem handoff, optOut ou funil), sem retries | Auto T7 |
| F04-E8 | E | Sem texto e sem tool -> auto-handoff existente | Auto T7 |
| F04-E9 | E | JSON Schema da tool `respond` sem `default`, sem `$ref`, `funnelStage` enum+null opcional, `optOut` boolean opcional | Auto T8 (aceitação pela API: Manual) |
| F04-E10 | E | Playground do agente, teste do agente e sugestão do inbox: texto direto vira resposta/sugestão | Manual (mesma regra, rotas sem teste automatizado; compiladas por tsc) |
| F04-E11 | E | Remover chave Anthropic apaga só a do tenant atual | Auto T10 |
| F04-E12 | E | Chat do inbox (`/api/inbox/chat`) com resposta só em texto: nada é enviado ao WhatsApp (a tool `respond` é quem envia) | Manual; ver "a verificar" |
| F04-N1 | N | Erro 401 da Anthropic em produção -> auto-handoff com o erro no motivo (mesmo caminho dos outros provedores) | Auto T7 |
| F04-N2 | N | Erro 429 -> auto-handoff | Auto T7 |
| F04-N3 | N | Erro 400 (ex.: parâmetro rejeitado) -> auto-handoff | Auto T7 |
| F04-N4 | N | Rotas de playground/teste mapeiam `statusCode` 401/429 do SDK para 401/429 | Manual (alteração de uma linha; sem teste de rota) |
| F04-N5 | N | Provedor inválido em `/api/ai/models` e DELETE -> 400 citando anthropic | Auto T10, T11 |


---

# F05 — modelo com cabeçalho de mídia

Fluxo: tela de criação de modelo (Cabeçalho: Imagem/Vídeo/Documento) -> `POST /api/meta/uploads/template-header` -> Meta (Resumable Upload) -> `header_handle` no payload do modelo -> disparo de campanha.

Legenda: A = automatizado (arquivo), M = manual (precisa de conta Meta real / navegador).

## Caminho feliz
| # | Caso | Tipo | Onde |
|---|------|------|------|
| H1 | Imagem PNG/JPG devolve handle usando App ID e token do tenant | A | app/api/meta/uploads/template-header/route.test.ts |
| H2 | Vídeo MP4 devolve handle | A | route.test.ts (16 MB) e lib/whatsapp/template-header-upload.test.ts |
| H3 | Protocolo: sessão `/{app}/uploads` + bytes com `OAuth` e `file_offset: 0` | A | template-header-upload.test.ts |
| H4 | Documento PDF aceito | A | template-header-upload.test.ts |
| H5 | Payload com `header_handle` aceito pelo schema; modelo de texto continua válido | A | lib/whatsapp/validators/template.schema.test.ts |
| H6 | Criar modelo com imagem na tela, aprovado pela Meta | M | exige Meta real |
| H7 | Criar modelo com vídeo, aprovado, e disparar campanha | M | exige Meta real |

## Bordas
| # | Caso | Tipo | Onde |
|---|------|------|------|
| B1 | Arquivo exatamente no limite (vídeo 16.000.000 B) aceito; +1 B recusado | A | template-header-upload.test.ts |
| B2 | Nome com acento e espaço ("Promoção Verão.mp4") | A | route.test.ts |
| B3 | Dois envios seguidos geram sessões e handles independentes | A | template-header-upload.test.ts |
| B4 | Trocar tipo do cabeçalho depois de enviar zera o handle e a prévia | M | StepContent.tsx (onValueChange) — ver "a verificar" |
| B5 | Conta sem ID do aplicativo: 400 orientando; opções de mídia ficam com cadeado na tela | A (rota) / M (tela) | route.test.ts |
| B6 | Sessão expirada: rota devolve 401 sem chamar a Meta | A | route.test.ts |
| B7 | Sem token de acesso: 400 | A | route.test.ts |
| B8 | MIME vazio: infere pela extensão | A | template-header-upload.test.ts |
| B9 | Cache de media id do cabeçalho: recente reaproveita; >25 dias, hash diferente ou sem data: regera | A | lib/whatsapp/header-media-cache.test.ts |
| B10 | Hospedagem com limite de corpo menor (Vercel ~4,5 MB) recusa vídeo grande com 413: mensagem clara | A | services/templateService.test.ts |

## Negativos
| # | Caso | Tipo | Onde |
|---|------|------|------|
| N1 | Tipo inválido (webp como imagem, mov como vídeo): 400 antes da Meta | A | route.test.ts, template-header-upload.test.ts |
| N2 | Arquivo grande demais: 400 antes da Meta | A | route.test.ts |
| N3 | Arquivo vazio, formato inexistente, arquivo ausente | A | route.test.ts |
| N4 | Meta recusa a sessão (token inválido): mensagem amigável, original só no log, token nunca aparece | A | template-header-upload.test.ts |
| N5 | Meta recusa os bytes | A | template-header-upload.test.ts |
| N6 | Resposta sem `id`/`h` | A | template-header-upload.test.ts |
| N7 | Tempo esgotado (504) e falha de rede (502) | A | template-header-upload.test.ts |
| N8 | Meta recusa o modelo (mídia fora do padrão, nome duplicado) | M | exige Meta real |
| N9 | Vídeo com codec fora de H.264/AAC: validação no navegador antes do envio | M | validateVideoCodecs (já existente) |
