# Plano de testes (replica) — IA no funil, opt-out e aviso de handoff

Legenda: H = caminho feliz, E = borda, N = negativo. "Auto" = automatizado (arquivo de teste); "Manual" = precisa de ambiente real (modelo de IA real, WhatsApp, banco) e NÃO foi executado nesta rodada.

Arquivos de teste:
- T1 `lib/opt-out-keywords.test.ts`
- T2 `lib/ai/funnel-classifier.test.ts`
- T3 `lib/ai/agents/chat-agent-funnel-optout.test.ts`
- T4 `lib/push-notifications.handoff.test.ts`
- T5 `app/api/ai/respond/route.test.ts`

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
