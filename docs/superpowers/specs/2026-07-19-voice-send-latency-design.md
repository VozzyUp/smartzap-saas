# Envio de nota de voz sem validações extras

## Objetivo

Reduzir a latência do envio de notas de voz no Inbox, mantendo o arquivo
compatível com o WhatsApp, e remover a confirmação visual redundante após o
envio.

## Decisão

O servidor continuará convertendo toda nota de voz para OGG/Opus mono, 48 kHz,
perfil VoIP e timestamps iniciando em zero. Essa é a conversão necessária para
o áudio ser reproduzível no WhatsApp.

Serão removidas as duas validações adicionadas após a conversão: a inspeção
local do cabeçalho OGG/Opus e o download do arquivo recém-enviado à Meta para
inspecioná-lo novamente. Assim, após o upload bem-sucedido, a rota enviará o
`media_id` diretamente à API de mensagens.

O cliente não exibirá mais o toast `Nota de voz enviada`; erros continuarão
sendo mostrados e o estado de envio continuará impedindo reenvios simultâneos.

## Fluxo resultante

`MediaRecorder` → remux FFmpeg OGG/Opus → upload Meta → envio por `media_id`
→ persistência no Inbox.

## Testes

- A rota de mídia com `voice=true` deve enviar o `media_id` sem chamar
  `downloadMetaMedia`.
- A interface de envio de voz não deve emitir toast de sucesso.
- A suíte existente de remux continua garantindo codec, canal, amostragem e
  timestamps normalizados.

## Fora de escopo

- Alterar codec, formato, credenciais, tabela, storage ou payload de envio à
  Meta.
- Alterar os toasts de erro ou o bloqueio durante o envio.
