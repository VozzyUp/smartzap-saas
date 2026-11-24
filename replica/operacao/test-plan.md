# Plano de testes: operação autônoma (F06 a F10)

Legenda: [A] automatizado (arquivo), [M] manual (precisa de serviço real; nada aqui chama Meta, QStash, Redis ou banco de verdade).

## F06 Aviso no celular (push)
- [A] Subscription gravada com o tenant_id do usuário logado: app/api/push/subscribe/route.test.ts
- [A] Sem sessão: 401, não grava. Usuário sem tenant: 403. Subscription inválida: 400 (mesmo arquivo)
- [A] Subscription expirada (410) removida com client admin filtrando endpoint e tenant: lib/push-notifications.expired.test.ts
- [A] Broadcast só do tenant: lib/push-notifications.handoff.test.ts
- [A] /api/push/send exige tenantId, nunca faz broadcast global; 401 sem chave: app/api/push/send/route.test.ts
- [M] Ativar notificações no celular, mandar mensagem de teste de outro número e ver o aviso chegar
- [M] Dois tenants com usuários diferentes: o aviso de um não chega ao outro
- [M] Usuário troca de conta no mesmo navegador: o endpoint passa a pertencer ao novo tenant (upsert por endpoint)

## F07 Robô só silencia para quem pediu para parar
- [A] inbound_keyword, ai_detected e meta_opt_out_error silenciam o robô: app/api/ai/respond/route.test.ts
- [A] auto_failure_policy NÃO silencia (robô responde): mesmo arquivo
- [A] Supressão sem source (bloqueio manual/legado) silencia: mesmo arquivo
- [A] Duas supressões (automática + opt-out): silencia: mesmo arquivo
- [A] Erro ao consultar supressão: 500 e nada enviado: mesmo arquivo (F02 existente)
- [A] Campanhas continuam pulando todas as supressões: não alterado (app/api/campaign/*, testes existentes)
- [M] Número com falha de entrega antiga escreve para a empresa e o robô responde

## F08 Alerta quando algo se perde
- [A] Helper: log estruturado, push ao tenant, limite 1 por tipo/tenant/10 min (Redis NX e memória), nunca lança, sem tenant só loga: lib/ops-alert.test.ts
- [A] Passar conversa para humano com nota interna; nunca lança: lib/ops-alert.test.ts
- [A] Sem agente / agente inativo: alerta + humano; falha de envio de todas as partes: alerta + humano; envio ok: sem alerta: app/api/ai/respond/route.test.ts
- [A] Falha ao publicar no QStash: alerta + humano; sucesso: sem alerta; produção sem QSTASH_TOKEN: alerta: lib/inbox/inbox-webhook.test.ts
- [A] Falha ao gravar mensagem recebida: alerta e webhook ainda responde 200; sucesso: sem alerta: app/api/webhook/route.test.ts
- [M] Erro geral do webhook (catch externo) dispara webhook_error: sem teste automatizado (difícil provocar o erro)
- [M] Ver o push chegar no celular e a conversa aparecer como pendente no atendimento

## F09 Interruptor global de IA
- [A] Desligado ('false'): não chama a IA, não envia, skipped=ai_globally_disabled: app/api/ai/respond/route.test.ts
- [A] Sem a setting: ligado. 'true': ligado. Erro de leitura: ligado: mesmo arquivo
- [M] Desligar na tela de configurações e mandar mensagem: robô não responde; a mensagem aparece no inbox

## F10 Follow-up automático

Autenticação e agendamento
- [A] Assinatura QStash válida roda; inválida/ausente/erro: 401; sem chaves nem segredo: 401; x-workflow-secret correto aceito, errado 401: app/api/kanban/followup-sweep/route.test.ts
- [A] Cron com scheduleId fixo (idempotente), segredo no header, memo por processo, nunca lança: lib/kanban-automation-schedule.test.ts
- [A] POST /api/kanban/followup-schedule: 401 sem sessão, 200, 502: app/api/kanban/followup-schedule/route.test.ts
- [A] Salvar regras registra o schedule; lista vazia não: app/api/kanban/automation-routes.test.ts
- [M] Com QSTASH_* reais: o schedule aparece no painel do QStash e chega no sweep com 200 (proxy libera a rota)

Janela de 24 h e modelo
- [A] Dentro da janela: texto; fora com modelo: modelo; fora sem modelo: não envia e registra motivo uma vez; nunca respondeu sem modelo: não envia: lib/kanban-followup-send.test.ts e lib/kanban-automation.test.ts
- [A] "Enviar sempre o modelo" envia o modelo mesmo dentro da janela: lib/kanban-followup-send.test.ts
- [A] Variáveis: {{nome}} = primeiro nome, reserva "Cliente", valor fixo (link), quantidade incompatível recusa, modelo inexistente/não aprovado recusa: lib/kanban-followup-send.test.ts
- [A] Associação regra->modelo em settings (por tenant, por estágio, valores fixos, alwaysSend, JSON corrompido): lib/kanban-followup-config.test.ts
- [A] API devolve e salva o modelo; valida o formato: lib/kanban-automation.test.ts e app/api/kanban/automation-routes.test.ts

Supressão, tentativas, tenant
- [A] Telefone suprimido (qualquer source) ou erro na consulta: não envia: lib/kanban-automation.test.ts
- [A] Falha de envio: 3 tentativas, depois desiste (índice avança) e alerta followup_gave_up: lib/kanban-automation.test.ts
- [A] Tenant bloqueado (trial/suspenso): não processa: lib/kanban-automation.test.ts

Base de tempo e uma vez por entrada (pedido do dono)
- [A] Prazo conta da entrada na fase (o mais recente entre moved_at e a última mensagem recebida); inbound antigo não antecipa: lib/kanban-automation.test.ts
- [A] Cada regra dispara uma vez por entrada: índice já avançado não repete a cada hora: lib/kanban-automation.test.ts
- [A] Mudança de fase zera next_followup_index (comportamento existente em lib/kanban.ts:461, coberto por lib/kanban.test.ts)

Gravação no inbox
- [A] Envio ok grava mensagem outbound na conversa (cria se não existir); falha ao gravar não desfaz o envio: lib/kanban-automation.test.ts

Casos do dono
- Fase "Mensagem enviada", 3 dias, modelo marcoo_estetica_segundo_contato com {{1}} = primeiro nome e "enviar sempre" ligado: [A] prazo, modelo e variáveis; [M] envio ponta a ponta. Se o contato responde, a IA move o cartão, o índice zera e a regra da fase antiga deixa de valer: [M]
- Fase "Link enviado", 1 dia, modelo marcoo_teste_lembrete com {{1}} = {{nome}} e {{2}} = link fixo: [A] variáveis (lib/kanban-followup-send.test.ts); [M] envio ponta a ponta
- [M] Tela: escolher modelo, preencher valores, ligar "enviar sempre", salvar e reabrir (valores voltam)
- [M] Horário comercial: ver "a verificar" F10-V1 (fuso do servidor)
