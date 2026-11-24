/**
 * Cache do media id de ENVIO do cabeçalho (templates.header_media_id).
 *
 * Media ids da Meta expiram em 30 dias. Reaproveitamos o id só enquanto o exemplo
 * continua o mesmo (hash) E o id foi gerado há menos de 25 dias (margem de segurança);
 * caso contrário o disparo gera um novo id a partir da mídia de exemplo.
 */
export const HEADER_MEDIA_ID_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000

export function isCachedHeaderMediaIdUsable(args: {
  id?: string | null
  cachedHash?: string | null
  exampleHash: string
  updatedAt?: string | null
  now?: number
}): boolean {
  if (!args.id || !args.cachedHash) return false
  if (args.cachedHash !== args.exampleHash) return false
  if (!args.updatedAt) return false
  const ts = Date.parse(args.updatedAt)
  if (!Number.isFinite(ts)) return false
  const now = args.now ?? Date.now()
  return now - ts < HEADER_MEDIA_ID_MAX_AGE_MS
}
