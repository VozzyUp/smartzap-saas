/**
 * Pré-checagem antes de disparar uma campanha com modelo de cabeçalho de mídia.
 * Evita seguir "sem mídia" (e falhar para todos os contatos) quando não há como obter a mídia.
 */
const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT', 'GIF']
const LABEL: Record<string, string> = { IMAGE: 'imagem', VIDEO: 'vídeo', DOCUMENT: 'documento', GIF: 'GIF' }

export type HeaderMediaReadiness = { ok: true } | { ok: false; message: string }

export function evaluateHeaderMediaReadiness(args: {
  headerFormat?: string | null
  /** headerMediaId enviado pelo usuário na campanha ("Enviar com este arquivo"). */
  providedMediaId?: string | null
  /** media id obtido pelo disparo a partir do exemplo do modelo (cache ou upload). */
  resolvedMediaId?: string | null
  exampleLink?: string | null
  /** O link de exemplo é um weblink da Meta (lookaside/fbcdn...), que expira ou exige autenticação. */
  exampleIsMetaWeblink: boolean
}): HeaderMediaReadiness {
  const format = String(args.headerFormat || '').toUpperCase()
  if (!MEDIA_FORMATS.includes(format)) return { ok: true }
  if (args.providedMediaId || args.resolvedMediaId) return { ok: true }
  if (args.exampleLink && !args.exampleIsMetaWeblink) return { ok: true }

  const label = LABEL[format] || 'mídia'
  return {
    ok: false,
    message:
      `Este modelo exige ${label} no cabeçalho, mas não foi possível obter a ${label} para o envio ` +
      `(o link de exemplo do modelo expirou ou não está acessível). Nenhuma mensagem foi enviada. ` +
      `Na nova campanha, use "Enviar com este arquivo" para anexar a ${label}, ou sincronize os modelos e tente de novo.`,
  }
}
