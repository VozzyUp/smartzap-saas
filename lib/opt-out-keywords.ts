/**
 * Detecção de pedido de opt-out por palavra-chave (PT-BR + EN).
 *
 * A palavra-chave só bloqueia quando a MENSAGEM INTEIRA é um pedido de saída;
 * frases maiores seguem para a IA (campo `optOut` em app/api/ai/respond), que
 * entende o contexto ("posso cancelar quando quiser?", "vou sair agora").
 *
 * Sobre o texto normalizado (minúsculas, sem acento, pontuação/emoji viram espaço):
 *  1. Bloqueia se a mensagem inteira é exatamente um pedido de saída
 *     (OPT_OUT_EXACT), tolerando cortesia nas pontas ("por favor", "obrigada", "ok"...).
 *  2. Bloqueia também mensagens de até 6 palavras que CONTENHAM uma frase
 *     inequívoca (OPT_OUT_UNAMBIGUOUS), ex.: "não tenho interesse, obrigada".
 * Sem regex dinâmica: só Set/array e comparação de strings (sem risco de backtracking).
 */

const OPT_OUT_EXACT = new Set([
  'parar', 'pare', 'stop', 'cancelar', 'cancele', 'sair', 'remover', 'remove',
  'descadastrar', 'desinscrever', 'unsubscribe', 'optout', 'opt-out',
  'nao quero', 'nao quero mais', 'nao quero receber', 'nao receber',
  'nao tenho interesse', 'sem interesse', 'parar de receber',
  'nao quero mais receber', 'nao me mande mais', 'nao mande mais',
  'pare de mandar', 'pare de me mandar', 'me tire da lista', 'me tira da lista',
  'sair da lista', 'remover da lista', 'nao envie mais', 'nao me envie mais',
])

const OPT_OUT_UNAMBIGUOUS = [
  'parar de receber', 'nao quero receber', 'nao quero mais receber',
  'nao tenho interesse', 'sem interesse', 'me tire da lista', 'me tira da lista',
  'nao me mande mais', 'nao mande mais', 'pare de mandar', 'pare de me mandar',
  'nao envie mais', 'nao me envie mais', 'descadastrar', 'desinscrever', 'unsubscribe',
]

const MAX_WORDS_UNAMBIGUOUS = 6

const COURTESY = ['por favor', 'pf', 'pfv', 'obrigado', 'obrigada', 'obg', 'ok', 'oi', 'ola']

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

/** Remove palavras de cortesia do início e do fim (repetidamente). */
function stripCourtesy(t: string): string {
  let s = t
  let changed = true
  while (changed && s) {
    changed = false
    for (const c of COURTESY) {
      if (s === c) return ''
      if (s.startsWith(c + ' ')) { s = s.slice(c.length + 1); changed = true }
      else if (s.endsWith(' ' + c)) { s = s.slice(0, -(c.length + 1)); changed = true }
    }
  }
  return s
}

export function isOptOutKeyword(text: string): boolean {
  const t = normalize(text)
  if (!t) return false

  if (OPT_OUT_EXACT.has(stripCourtesy(t))) return true

  // contagem de palavras sem alocar array para textos longos
  let words = 1
  for (let i = 0; i < t.length && words <= MAX_WORDS_UNAMBIGUOUS; i++) {
    if (t.charCodeAt(i) === 32) words++
  }
  if (words > MAX_WORDS_UNAMBIGUOUS) return false

  const padded = ` ${t} `
  return OPT_OUT_UNAMBIGUOUS.some((p) => padded.includes(` ${p} `))
}
