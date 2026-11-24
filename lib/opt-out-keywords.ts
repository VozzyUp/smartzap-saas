/**
 * Detecção de pedido de opt-out por palavra-chave (PT-BR + EN).
 *
 * Match por PALAVRA/FRASE INTEIRA (não por substring): "parece interessante",
 * "comparar", "aparecer" e "removedor" não são opt-out; "parar", "PARAR de
 * receber", "não tenho interesse" são. Acentos e caixa são normalizados.
 */

const OPT_OUT_PHRASES = [
  'parar',
  'pare',
  'stop',
  'cancelar',
  'cancele',
  'sair',
  'remover',
  'remove',
  'descadastrar',
  'desinscrever',
  'unsubscribe',
  'optout',
  'opt-out',
  'nao quero',
  'nao receber',
  'nao tenho interesse',
  'sem interesse',
]

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // colapsa qualquer separador (pontuação, espaços, emoji) em espaço simples,
    // preservando o hífen interno de "opt-out"
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()
}

const OPT_OUT_REGEX = new RegExp(
  `(?:^| )(?:${OPT_OUT_PHRASES.map((p) => p.replace(/-/g, '\-')).join('|')})(?: |$)`
)

export function isOptOutKeyword(textRaw: string): boolean {
  const t = normalize(textRaw)
  if (!t) return false
  return OPT_OUT_REGEX.test(t)
}
