# Bugs (replica) — IA no funil, opt-out e aviso de handoff

Severidades: S1 perda de dado/segurança/fluxo central bloqueado; S2 função quebrada sem contorno; S3 quebrada com contorno ou visivelmente errada; S4 cosmética.
Evidência (arquivo:linha) refere-se ao código ANTES das correções (origin/main 5043072).

## BUG-001 — Bot responde após opt-out (S1)
- Passos: lead envia "PARAR" (webhook grava `phone_suppressions`) e depois envia outra mensagem, ou a mesma mensagem já está na fila do QStash. A conversa está em modo `bot`.
- Esperado: o bot não escreve mais para quem pediu para parar.
- Atual: `/api/ai/respond` só checa `mode`, pausa e agente; nunca consulta `phone_suppressions`. O bot responde (campanhas pulavam o suprimido, o bot não).
- Evidência: `app/api/ai/respond/route.ts:130` (checagens iniciais sem consulta de supressão).
- Correção: commit 9bd8831 (checagem 4.5 em `/api/ai/respond`; teste F02-H3 em `route.test.ts`).

## BUG-002 — "Não tenho interesse" não suprime (S2)
- Passos: lead responde "Não tenho interesse" / "sem interesse".
- Esperado: opt-out (IA ou palavra-chave).
- Atual: nenhuma palavra-chave cobria a frase e a IA não tinha como sinalizar; o lead continua recebendo mensagens.
- Evidência: `app/api/webhook/route.ts:145-177` (lista de palavras sem essas frases); schema do agente sem `optOut` (`lib/ai/agents/chat-agent.ts:138-165`).
- Correção: commits ff6730f (frases novas na lista) e c74c726 + 9bd8831 (campo `optOut` na resposta da IA, supressão `ai_detected`).

## BUG-003 — Falso positivo por substring (S2)
- Passos: lead escreve "parece interessante", "vou comparar", "pode aparecer aí", "removedor".
- Esperado: não é opt-out.
- Atual: `t.includes(k)` casa "pare" em "parece", "comparar", "aparecer" e "remove" em "removedor"; o lead interessado é suprimido e some das campanhas.
- Evidência: `app/api/webhook/route.ts:177` (`keywords.some((k) => t.includes(k))`).
- Correção: commit ff6730f (`lib/opt-out-keywords.ts`, match por palavra inteira; tabela em `lib/opt-out-keywords.test.ts`).

## BUG-004 — Sem aviso ao dono no handoff (S3)
- Passos: IA devolve `shouldHandoff` (ou erro da IA gera auto-handoff). A conversa vira `human`.
- Esperado: dono/atendentes são avisados.
- Atual: só nota interna no inbox; `sendNewMessageNotification`/`broadcastPushNotification` não têm chamador no fluxo, e `broadcastPushNotification` usa client de sessão (sem escopo de tenant, inutilizável em worker).
- Evidência: `app/api/ai/respond/route.ts:195` e `:307` (sem push); `lib/push-notifications.ts:117` (select sem tenant_id).
- Correção: commits c5def9b (push escopado por tenant) e 9bd8831 (chamadas na rota).

## BUG-005 — Funil não classificado pela IA (S3)
- Passos: lead conversa com o bot; o card só se move por regras fixas (message_sent/client_replied/quote_detected), nunca pela análise da conversa.
- Esperado: a IA decide a fase do funil.
- Atual: nenhuma ligação entre a resposta do agente e o kanban além de `detectedQuoteRequest`.
- Evidência: `app/api/ai/respond/kanban-automation-hook.ts:11-23`.
- Correção: commits 3805cdd, c74c726 e 9bd8831.

## BUG-006 — Provedor desconhecido usava a chave da OpenAI (S3, latente)
- Passos: nas rotas de agente/inbox e nos serviços de IA, o código era `if (provider === 'google') ... else openai`; qualquer terceiro provedor cairia na chave/modelo da OpenAI.
- Esperado: cada provedor usa a própria chave.
- Atual (antes): `else` implícito da OpenAI em `app/api/ai-agents/[id]/chat/route.ts`, `[id]/test/route.ts`, `app/api/inbox/chat/route.ts`, `inbox/suggest/route.ts`, `lib/ai/services/ai-judge.ts`, `template-agent.ts`, `lib/ai/unified-ai-service.ts`.
- Correção: fábrica única `lib/ai/llm-model.ts` (teste `lib/ai/llm-model.test.ts`) e ramo explícito na Anthropic.

## BUG-007 — Gerador de templates UTILITY não rodava o juiz sem chave Google (S3)
- Passos: conta com Anthropic como provedor e sem `google_api_key`, estratégia `utility`.
- Atual (antes): o juiz só rodava com `apiKey` Google (`app/api/ai/generate-utility-templates/route.ts`), então o filtro de neutralidade era pulado em silêncio.
- Correção: usa a chave Anthropic quando esse é o provedor ativo. Sem teste automatizado da rota (marcado como manual).

## A verificar (suspeitas NÃO reproduzidas em teste)
1. `app/api/push/subscribe/route.ts` faz upsert em `push_subscriptions` sem `tenant_id`, e a coluna é NOT NULL sem default (`supabase/migrations/20260708000002_multitenancy_add_tenant_id.sql`). Se não houver trigger/default no banco real, nenhuma subscription é salva e o push de handoff nunca chega. Não foi possível consultar o banco; precisa conferir se existem linhas em `push_subscriptions`.
2. `removeInvalidSubscription` (lib/push-notifications.ts) usa o client de sessão (cookies); em worker QStash pode falhar ao limpar subscription 410 (só loga).
3. Corrida webhook x worker: o opt-out por palavra-chave é gravado depois do enfileiramento da IA; a primeira resposta do bot pode sair mesmo assim se o worker rodar antes. A IA sinalizando `optOut` cobre parte do caso.
4. `app/api/push/send/route.ts` usa `broadcastPushNotification` sem tenant (broadcast global por sessão); revisar escopo.
5. Palavras genéricas herdadas ("cancelar", "remover", "nao quero") ainda causam opt-out em frases como "quero cancelar o pedido"; avaliar com o dono.
6. Compatibilidade do enum `funnelStage` (anyOf com null) com todos os provedores/modelos configuráveis do agente (Gemini/OpenAI); só validado no schema zod, não com modelo real.
7. Anthropic: nada foi chamado contra a API real. Falta confirmar com chave real: (a) o enum anulável `funnelStage` e `optOut` são aceitos no `input_schema` da tool; (b) `toolChoice: 'auto'` + instrução no prompt faz o Claude chamar `respond` na grande maioria dos casos (senão o texto direto vira a mensagem, com confiança 0.3); (c) 2000 tokens de piso bastam com o raciocínio sempre ligado (se a resposta vier cortada, subir o piso em `lib/ai/anthropic-support.ts`); (d) a lista de modelos é fixa (`claude-*-5-5`): se algum id não existir na conta, a chamada dá 404.
8. `/api/inbox/chat` (streaming no inbox): a resposta só é enviada ao WhatsApp dentro da execução da tool `respond`. Com a Anthropic (toolChoice `auto`), uma resposta só em texto não envia nada. O chat-agent principal (webhook) trata o texto, esta rota não.
9. `app/api/ai-agents/llm-providers/route.ts` marca o provedor como disponível também por variável de ambiente (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`), mas `getAiDirectConfig` só lê as chaves da conta; o agente aparece com modelo selecionável e falha na hora de responder. Comportamento herdado, vale para os três provedores.
10. Agente com modelo `claude-*` salvo, mas conta com provedor Google/OpenAI: o id vai para o provedor errado e dá 404 (o contrário, modelo de outro provedor com Anthropic ativa, já cai no padrão). Herdado do desenho (modelo do agente sobrepõe o da conta).
11. Embeddings (`lib/ai/embeddings.ts`) passam pelo AI Gateway com `VERCEL_OIDC_TOKEN`/`AI_GATEWAY_API_KEY` ou `'dummy'`, não pelas chaves da conta; fora do escopo e igual para qualquer provedor de chat.


---

# F05 — modelo com cabeçalho de mídia: bugs

## Corrigidos neste worktree
| ID | Sev | Descrição | Evidência | Correção |
|----|-----|-----------|-----------|----------|
| F05-1 | S2 | Disparo reaproveitava `header_media_id` em cache sem checar idade. Media ids da Meta expiram em 30 dias; depois disso o envio com cabeçalho de mídia falha. | `app/api/campaign/workflow/route.ts` comparava só `cachedHash === exampleHash`; `header_media_updated_at` era gravado mas nunca lido. | `lib/whatsapp/header-media-cache.ts` (25 dias); teste `header-media-cache.test.ts`. |
| F05-2 | S2 | Gravação do cache de mídia do cabeçalho (e do preview) em `templates` filtrava só `name`, sem `tenant_id`: dois tenants com modelo de mesmo nome sobrescreviam o cache um do outro. | 3 chamadas `.eq('name', templateName)` no workflow, com a constraint única `(tenant_id, name, language)`. | `.eq('tenant_id', tenantId)` adicionado. Sem teste automatizado (rota enorme); validar com dois tenants. |
| F05-3 | S3 | Tela e rota limitavam vídeo e documento a 4,5 MB (limite da Vercel) mesmo com o app configurado para 20 MB. Meta aceita vídeo de 16 MB. | `VERCEL_SERVERLESS_LIMIT` em rota e tela. | Limites únicos em `lib/whatsapp/template-header-upload.ts`, vídeo 16 MB. |
| F05-4 | S4 | Rota devolvia `details` (texto interno do erro) ao navegador e logava erro completo. | rota antiga | Resposta só com mensagem amigável; log sem token. |

## A verificar (suspeitas não reproduzidas)
- V1: Em hospedagem Vercel o corpo de requisição acima de ~4,5 MB é recusado pela plataforma antes da rota (vídeo 5 a 16 MB falha com 413). A mensagem agora é clara, mas o upload não funciona nesse ambiente. Confirmar onde o app roda.
- V2: Sem ID do aplicativo configurado, Imagem/Vídeo/Documento ficam bloqueados (cadeado) na tela. É o motivo provável de "não deixa criar". Confirmar se o tenant do dono tem `metaAppId` em settings.
- V3: Documento limitado a 16 MB (Meta aceita 100 MB) por causa do transporte de 20 MB.
- V4: Trocar o tipo do cabeçalho (Imagem para Vídeo) zera o handle em `onValueChange`, mas a prévia local só é limpa por efeito; testar na tela.
- V5: O token vai na query string na etapa 1 (padrão já usado no código). Se algum proxy registrar URLs, o token aparece. A doc atual da Meta aceita `Authorization`; migrar é uma linha, mas não foi validado contra a Meta real.
- V6: Os links de exemplo devolvidos pela Meta (scontent) podem expirar; o disparo baixa o exemplo para gerar o media id e, se o download falha, segue sem media id (best-effort), e a Meta pode recusar o envio. Não há tela para escolher mídia própria no disparo.
- V7: A rota `/api/settings/meta-app` e `getMetaAppId` leem só `settings.metaAppId` do tenant (não há fallback para variável de ambiente); a rota `settings/all` menciona `META_APP_ID`. Confirmar se a variável deveria valer como padrão.
