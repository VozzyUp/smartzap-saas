# Bugs encontrados: operação autônoma

Linhas de evidência referem-se ao main antes das correções (origin/main 9d2e5a0). Commits de correção estão no branch feat/operacao-autonoma (títulos na coluna Correção).

| ID | Sev | Fluxo | Resumo | Correção |
|---|---|---|---|---|
| F06-B1 | S1 | F06 | Subscription de push gravada sem tenant_id (coluna NOT NULL) e com client de sessão; o insert falha e ninguém recebe aviso | "fix(push): grava tenant_id..." |
| F06-B2 | S2 | F06 | Remoção de subscription expirada usava client de sessão dentro de worker (sem cookie, não remove) e sem filtro de tenant | idem |
| F06-B3 | S2 | F06 | /api/push/send fazia broadcast sem tenant | idem; agora exige tenantId |
| F07-B1 | S2 | F07 | Robô silenciava para qualquer supressão, inclusive a automática por falha de entrega | "feat(operacao): alerta operacional, silêncio..." |
| F08-B1 | S1 | F08 | Falhas (gravar inbound, publicar no QStash, enviar resposta da IA, sem agente) só iam para console; o lead ficava sem resposta sem ninguém saber | idem e "alertas e passagem para humano" |
| F09-B1 | S2 | F09 | ai_agents_global_enabled não desligava o robô (só sugestões/debug) | "feat(operacao): alerta operacional, silêncio..." |
| F10-B1 | S1 | F10 | registerFollowupSweepSchedule nunca era chamada: o cron não existia | "feat(followup): autentica o sweep..." |
| F10-B2 | S1 | F10 | Proxy barrava /api/kanban/followup-sweep (401) para o QStash; rota sem verificação de assinatura (e aberta se sem segredo configurado) | idem |
| F10-B3 | S1 | F10 | Follow-up mandava texto livre; fora de 24h a Meta recusa, e a falha era engolida e repetida toda hora para sempre | "feat(followup): modelo aprovado fora da janela..." |
| F10-B4 | S1 | F10 | Follow-up ignorava phone_suppressions | idem |
| F10-B5 | S2 | F10 | Base do prazo era last_inbound_at ?? moved_at: um inbound antigo (anterior à entrada na fase) disparava a regra na hora; agora usa o mais recente dos dois | idem |
| F10-B6 | S3 | F10 | Follow-up enviado não era gravado no inbox: a IA não via o que foi enviado quando o lead respondia | idem |
| F10-B7 | S3 | F10 | Sweep processava tenants bloqueados (trial/suspensão) e um erro em um cartão abortava a varredura inteira | idem |
| F08-B2 | S3 | F08 | getAgentForTrigger (inbox-webhook) buscava o agente padrão sem filtro de tenant (afetava só o debounce) | "alertas e passagem para humano" |

## Evidências (main antes)
- F06-B1: app/api/push/subscribe/route.ts:17-27 (upsert sem tenant_id); migração 20260708000002 (tenant_id NOT NULL sem default).
- F06-B2: lib/push-notifications.ts:237 (createClient() em removeInvalidSubscription).
- F06-B3: lib/push-notifications.ts:117 (broadcast com createClient()) e app/api/push/send/route.ts.
- F07-B1: app/api/ai/respond/route.ts:156 (`suppressions.size > 0`); lib/auto-suppression.ts:180 (source auto_failure_policy).
- F08-B1: lib/inbox/inbox-webhook.ts:456; app/api/webhook/route.ts:1021 e 1640; app/api/ai/respond/route.ts:165-166 e 321.
- F09-B1: app/api/ai/respond/route.ts sem leitura da setting; leitura só em app/api/inbox/suggest/route.ts:71.
- F10-B3: lib/kanban-automation.ts:439 (`if (!result.success) return`).
- F10-B5: lib/kanban-automation.ts:398.
- F10-B1/B2: nenhuma chamada de registerFollowupSweepSchedule; proxy.ts PUBLIC_API_ROUTES sem a rota; app/api/kanban/followup-sweep/route.ts liberava tudo sem KANBAN_FOLLOWUP_SWEEP_SECRET.

## A verificar (suspeitas não reproduzidas)
- F10-V1: isWithinFollowupWindow usa a hora local do servidor (now.getHours()). Se o servidor roda em UTC, a janela 09:00-18:00 vale em UTC (06:00-15:00 no Brasil). Não alterei; confirmar o fuso do container (ou fixar America/Sao_Paulo).
- F10-V2: com day_offset mínimo de 1 dia, o texto livre dentro das 24h praticamente nunca acontece (o prazo conta a partir de uma mensagem recebida há 24h ou mais). Na prática todo follow-up precisa de modelo; a checagem de janela fica como proteção.
- F10-V3: sem Redis, o contador de tentativas e o "motivo registrado uma vez" ficam só na memória do processo (reiniciam a cada deploy/instância).
- F08-V1: o webhook devolve 200 mesmo quando o inbound não foi gravado (a Meta não reenvia). Agora há alerta, mas a mensagem em si se perde; avaliar responder 500 para a Meta reenviar.
- F07-V1: supressão sem source (legado/manual) é tratada como opt-out por segurança (decisão deliberada).
