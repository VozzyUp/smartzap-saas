/**
 * Upload da mídia de EXEMPLO do cabeçalho de templates (Graph Resumable Upload API).
 *
 * Diferente do media id de ENVIO (`/{phone-number-id}/media`, ver ./media.ts), o exemplo
 * exigido na criação do modelo é um "handle" (`header_handle`) gerado por:
 *   1) POST /{app_id}/uploads?file_name&file_length&file_type  -> { id: "upload:..." }
 *   2) POST /upload:...  (Authorization: OAuth <token>, file_offset: 0, corpo = bytes) -> { h }
 *
 * Código compartilhado entre a rota de API e a interface (limites/validação).
 * A parte de rede é só para uso no servidor.
 */

// O projeto usa a v24.0 literal em todas as chamadas ao Graph (não há constante central).
export const GRAPH_API_VERSION = 'v24.0'

export type TemplateHeaderMediaFormat = 'IMAGE' | 'VIDEO' | 'GIF' | 'DOCUMENT'

/**
 * Limite do transporte: next.config.ts define proxyClientMaxBodySize/bodySizeLimit = 20mb.
 * Deixamos folga para o envelope multipart. Em hospedagem serverless com limite de corpo
 * menor (ex.: Vercel ~4,5 MB) a plataforma recusa antes da rota (HTTP 413).
 */
export const TRANSPORT_MAX_BYTES = 16_000_000

export const TEMPLATE_HEADER_LIMITS: Record<
  TemplateHeaderMediaFormat,
  { maxBytes: number; mimeTypes: string[]; accept: string; label: string; hint: string }
> = {
  IMAGE: {
    maxBytes: 5_000_000,
    mimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
    accept: 'image/png,image/jpeg',
    label: 'imagem',
    hint: 'Máximo: 5 MB. Formatos: JPG ou PNG.',
  },
  VIDEO: {
    maxBytes: 16_000_000,
    mimeTypes: ['video/mp4'],
    accept: 'video/mp4',
    label: 'vídeo',
    hint: 'Máximo: 16 MB. Formato: MP4 (H.264 + AAC).',
  },
  GIF: {
    maxBytes: 3_500_000,
    mimeTypes: ['video/mp4'],
    accept: 'video/mp4',
    label: 'GIF',
    hint: 'Máximo: 3,5 MB. Formato: MP4 (como GIF animado).',
  },
  DOCUMENT: {
    // A Meta aceita até 100 MB, mas o transporte da aplicação limita a 16 MB.
    maxBytes: Math.min(100_000_000, TRANSPORT_MAX_BYTES),
    mimeTypes: ['application/pdf'],
    accept: 'application/pdf',
    label: 'documento',
    hint: 'Máximo: 16 MB (limite da aplicação). Formato: PDF.',
  },
}

export function guessHeaderMimeType(fileName: string, providedType?: string): string {
  const t = String(providedType || '').trim()
  if (t && t !== 'application/octet-stream') return t

  const name = String(fileName || '').toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.mp4')) return 'video/mp4'

  return t || 'application/octet-stream'
}

export type HeaderFileValidation = { ok: true; mimeType: string } | { ok: false; error: string }

function formatMb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace('.', ',')
}

export function validateTemplateHeaderFile(args: {
  format: string
  fileName: string
  size: number
  mimeType?: string
}): HeaderFileValidation {
  const limits = TEMPLATE_HEADER_LIMITS[args.format as TemplateHeaderMediaFormat]
  if (!limits) {
    return { ok: false, error: 'Formato inválido. Use IMAGE, VIDEO, GIF ou DOCUMENT.' }
  }

  if (!Number.isFinite(args.size) || args.size <= 0) {
    return { ok: false, error: 'O arquivo está vazio.' }
  }

  const mimeType = guessHeaderMimeType(args.fileName, args.mimeType)
  if (!limits.mimeTypes.includes(mimeType)) {
    return {
      ok: false,
      error: `Tipo de arquivo inválido para ${limits.label}. Recebido: ${mimeType}. ${limits.hint}`,
    }
  }

  if (args.size > limits.maxBytes) {
    return {
      ok: false,
      error: `Arquivo muito grande para ${limits.label} (${formatMb(args.size)} MB). Limite: ${formatMb(limits.maxBytes)} MB.`,
    }
  }

  return { ok: true, mimeType }
}

export class TemplateHeaderUploadError extends Error {
  /** Mensagem segura para mostrar na tela. */
  userMessage: string
  /** Status HTTP sugerido para a rota. */
  status: number
  /** Detalhe original da Meta (sem token). */
  details: unknown

  constructor(userMessage: string, status = 502, details: unknown = null) {
    super(userMessage)
    this.name = 'TemplateHeaderUploadError'
    this.userMessage = userMessage
    this.status = status
    this.details = details
  }
}

type GraphErrorBody = {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string }
}

type FetchLike = (input: string | URL, init?: any) => Promise<Response>

function redact(text: string, token: string): string {
  return token ? text.split(token).join('[token]') : text
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function timedFetch(fetchImpl: FetchLike, url: string | URL, init: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function friendlyMetaMessage(code: number | undefined, fallback: string): string {
  if (code === 190) return 'A Meta recusou o token de acesso (inválido ou expirado). Atualize as credenciais em Configurações.'
  if (code === 100) return 'A Meta recusou o upload do arquivo (parâmetro inválido ou sessão expirada). Tente novamente.'
  return fallback
}

export async function uploadTemplateHeaderSample(args: {
  appId: string
  accessToken: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
  fetchImpl?: FetchLike
}): Promise<{ handle: string }> {
  const { appId, accessToken, fileName, mimeType, bytes } = args
  const fetchImpl: FetchLike = args.fetchImpl ?? ((input, init) => fetch(input, init))

  const fail = (stage: string, status: number, userMessage: string, original: unknown): never => {
    // Mensagem original da Meta vai para o log (sem token); a tela recebe a versão amigável.
    console.error(
      `[template-header-upload] ${stage}:`,
      redact(typeof original === 'string' ? original : JSON.stringify(original ?? null), accessToken)
    )
    throw new TemplateHeaderUploadError(userMessage, status, original && typeof original === 'object' ? original : null)
  }

  const wrapNetwork = (stage: string, err: unknown): never => {
    if (err instanceof TemplateHeaderUploadError) throw err
    const name = (err as any)?.name
    const raw = redact(err instanceof Error ? err.message : String(err), accessToken)
    if (name === 'AbortError' || /timeout/i.test(raw)) {
      return fail(stage, 504, 'Tempo esgotado ao enviar o arquivo para a Meta. O arquivo pode ser grande ou a conexão está lenta. Tente novamente.', raw)
    }
    return fail(stage, 502, 'Falha de comunicação com a Meta. Tente novamente em instantes.', raw)
  }

  // Etapa 1: abre a sessão de upload
  const startUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(appId)}/uploads`)
  startUrl.searchParams.set('file_name', fileName)
  startUrl.searchParams.set('file_length', String(bytes.byteLength))
  startUrl.searchParams.set('file_type', mimeType)
  // Padrão já usado em produção neste projeto (token na query só nesta etapa; a URL nunca é logada).
  startUrl.searchParams.set('access_token', accessToken)

  let startRes: Response
  try {
    startRes = await timedFetch(fetchImpl, startUrl, { method: 'POST' }, 12_000)
  } catch (err) {
    return wrapNetwork('sessão', err)
  }
  const startBody = await readJson<{ id?: string } & GraphErrorBody>(startRes)
  if (!startRes.ok) {
    const meta = startBody?.error
    return fail(
      'sessão',
      502,
      friendlyMetaMessage(meta?.code, `A Meta recusou o início do upload${meta?.message ? `: ${redact(meta.message, accessToken)}` : '.'}`),
      { status: startRes.status, error: startBody?.error ?? null }
    )
  }
  const uploadId = String(startBody?.id || '').trim()
  if (!uploadId.startsWith('upload:')) {
    return fail('sessão', 502, 'A Meta iniciou o upload, mas não devolveu um identificador de sessão válido.', startBody)
  }

  // Etapa 2: envia os bytes (um único bloco)
  const timeoutMs = Math.min(120_000, Math.max(30_000, Math.ceil(bytes.byteLength / 1_000_000) * 5_000))
  let transferRes: Response
  try {
    transferRes = await timedFetch(
      fetchImpl,
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${uploadId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        body: bytes,
      },
      timeoutMs
    )
  } catch (err) {
    return wrapNetwork('bytes', err)
  }
  const transferBody = await readJson<{ h?: string } & GraphErrorBody>(transferRes)
  if (!transferRes.ok) {
    const meta = transferBody?.error
    return fail(
      'bytes',
      502,
      friendlyMetaMessage(meta?.code, `A Meta recusou o envio do arquivo${meta?.message ? `: ${redact(meta.message, accessToken)}` : '.'}`),
      { status: transferRes.status, error: transferBody?.error ?? null }
    )
  }

  const handle = String(transferBody?.h || '').trim()
  if (!handle) {
    return fail('bytes', 502, 'Upload concluído, mas a Meta não devolveu o identificador (handle) do exemplo.', transferBody)
  }

  return { handle }
}
