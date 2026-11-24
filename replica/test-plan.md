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
