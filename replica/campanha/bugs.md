# Bugs e achados: campanha, modelos e integração

Nenhum bug S1 a S4 foi reproduzido em código existente. Achados e riscos abaixo.

## Corrigidos neste trabalho
| ID | Sev | Resumo | Evidência | Commit |
|---|---|---|---|---|
| B-01 | S3 | Modelo com cabeçalho de mídia cujo exemplo expirou seguia "sem mídia" e falhava para todos os contatos | app/api/campaign/workflow/route.ts (bloco preventivo de mídia; antes só `template_media_id_prepare_skip`) | commit "mídia própria... falha visível" |
| B-02 | S3 | Não havia limite diário: um disparo frio inteiro saía no mesmo dia | dispatch/route.ts, só throttle por segundo | commit "limite diário" |

## A verificar (suspeitas não reproduzidas)
| ID | Sev | Suspeita | Evidência |
|---|---|---|---|
| V-01 | S3 | `campaigns.sent` conta só status 'sent' (init.sql:186) ou é cumulativo? O rótulo de andamento usa max(sent, delivered, read) | supabase/migrations/00000000000000_init.sql:186-188; lib/campaign-progress-label.ts |
| V-02 | S3 | Dois disparos simultâneos da mesma conta podem passar do limite diário (saldo lido antes de o outro reservar 'sending') | lib/campaign-daily-limit.ts countSentToday |
| V-03 | S4 | Idempotência da integração usa settings (uma linha por evento): cresce sem limpeza; getAll carrega tudo | lib/integrations/lead-event.ts idempotencyKey |
| V-04 | S3 | Continuação do dia seguinte depende de status SCHEDULED definido ao fim do workflow; se o workflow demorar mais de um dia ou falhar no último passo, a continuação é ignorada | dispatch/route.ts guarda trigger==='schedule' |
| V-05 | S4 | Em localhost (dev) a continuação não é agendada (sem QStash) | dispatch/route.ts |
| V-06 | S4 | Fuso fixo America/Sao_Paulo; sem setting de fuso por conta | lib/campaign-daily-limit.ts |
| V-07 | S4 | CampaignWizardView/useCampaignWizard (fluxo antigo) não ganhou os campos de mídia e funil; só o assistente real (campaigns/new) | hooks/useCampaignWizard.ts |
