# Plano de testes: campanha, modelos e integração

Legenda: A = automatizado (arquivo), M = manual (não rodado: nada aqui chama Meta, QStash ou banco reais).

## F11 Limite diário de disparo
| Caso | Tipo | Onde |
|---|---|---|
| Feliz: limite 3, 1 já enviado hoje, envia 2 e adia o resto para amanhã 9h | A | lib/campaign-daily-limit.test.ts (planDailyDispatch) |
| Sem limite (ausente/0/lixo/negativo) mantém o comportamento atual e não consulta o banco | A | idem (parseDailyLimit, planDailyDispatch) |
| Saldo cobre tudo: sem reprogramação | A | idem |
| Borda: saldo zerado adia tudo; lista vazia; dia em UTC diferente do dia em Brasília | A | idem (getDayStartUtc, getNextRunAt) |
| Negativo: falha ao contar propaga (não envia no escuro) | A | idem (countSentToday, planDailyDispatch) |
| Setting por tenant: GET/POST, 401, 422 para valor inválido | A | app/api/settings/campaign-daily-limit/route.test.ts |
| Tela: carrega, mostra ajuda quando vazio, salva | A | components/features/settings/CampaignDailyLimitCard.test.tsx |
| Rótulo "Em andamento: X de Y enviados, próximos Z amanhã" | A | lib/campaign-progress-label.test.ts |
| Idempotência: reexecução do dispatch não reenvia (contatos locked ficam fora do saldo; workflow só "claima" pending) | M | código: dispatch/route.ts (lockedContactIds), workflow bulkClaimPendingForSend |
| Ponta a ponta com QStash: dia 1 envia N, campanha vira Agendada, dia 2 continua | M | requer QStash real |
| Cancelar agendamento da continuação (cancel-schedule) | M | |

## F12 Mídia própria no disparo
| Caso | Tipo | Onde |
|---|---|---|
| Upload feliz de imagem e vídeo com credenciais do tenant | A | app/api/campaigns/header-media/route.test.ts |
| Negativos: 401, sem arquivo/formato 400, tipo errado 422, imagem > 5 MB e vídeo > 16 MB 422, sem WhatsApp 409, Meta recusa 502 | A | idem |
| Campo na tela: validação local sem rede, upload, erro do servidor, remover | A | components/features/campaigns/HeaderMediaUploadField.test.tsx |
| Falha visível: sem media id e exemplo expirado/weblink da Meta falha a campanha antes de enviar | A | lib/whatsapp/header-media-preflight.test.ts (decisão) |
| A campanha realmente para antes do primeiro contato e mostra last_error | M | workflow (headerMediaBlockMessage) |
| Media id expira em 30 dias: campanha agendada longe usa id vencido | M | |

## F13 ID do aplicativo da Meta visível
| Caso | Tipo | Onde |
|---|---|---|
| Cartão em Números: não informado, salvo, salvar | A | components/features/settings/MetaAppCard.test.tsx |
| Campo no criador de modelo: validação 5-20 dígitos, salvar, limpar | A | components/features/templates/builder/MetaAppIdInline.test.tsx |
| Criador de modelo existente continua passando | A | components/features/templates/ManualTemplateBuilder.test.tsx |
| Aviso aparece no bloco do cabeçalho antes de "Adicionar cabeçalho" só sem ID | M | StepContent.tsx |

## F14 Evento de entrada do produto vendido
| Caso | Tipo | Onde |
|---|---|---|
| Feliz: contato existente move/cria na fase mapeada; `stage` do corpo vence o mapa | A | lib/integrations/lead-event.test.ts |
| Cria contato quando vem `name`; sem `name` 404 | A | idem |
| 404 fase inexistente (lista fases), 404 sem quadro; 422 telefone/corpo inválido | A | idem, route.test.ts |
| Evento sem fase mapeada: 200 sem mexer no funil | A | idem |
| Idempotência externalId+event; event diferente não é duplicata; falha não grava a marca | A | idem |
| Token por conta: formato, hash, adulterado, outra conta, sem configuração; 401 na rota | A | idem, app/api/integrations/lead-event/route.test.ts |
| Limite de requisições (janela por conta) | A | idem (checkRateLimit); 429 na rota | 
| Rota pública no proxy sem sessão | M | proxy.ts |
| Geração do token e do mapa (rota de sessão) | M | app/api/settings/integration-token/route.ts (sem tela) |

## F15 Ao enviar, colocar o contato na fase
| Caso | Tipo | Onde |
|---|---|---|
| Cria o cartão na fase escolhida para cada contato aceito | A | lib/campaign-funnel-card.test.ts |
| Não duplica nem move para trás (card_exists); reexecução só acha existentes | A | idem |
| Falha em um contato não interrompe os demais nem lança | A | idem |
| Seletor só aparece com quadro; um ou vários quadros; limpar | A | components/features/campaigns/FunnelStageSelect.test.tsx |
| Workflow: só contatos com status sent/delivered/read do batch recebem cartão | M | workflow (bloco "Funil") |
| Isolamento por tenant do addCardToBoard (guarda de posse do contato) | M | lib/kanban.ts já valida |
