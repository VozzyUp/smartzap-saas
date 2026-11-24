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
