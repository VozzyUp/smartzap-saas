/**
 * URL pública da aplicação, usada para montar callbacks (QStash), webhooks
 * e links absolutos. Fonte única de verdade — substitui a antiga cadeia de
 * fallbacks com variáveis VERCEL_*.
 *
 * @param fallbackOrigin origin do request (ex.: `new URL(req.url).origin`),
 *   usado apenas quando NEXT_PUBLIC_APP_URL não está setada.
 */
export function getAppUrl(fallbackOrigin?: string | null): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  if (fallbackOrigin) return fallbackOrigin.trim().replace(/\/+$/, '')
  return 'http://localhost:3000'
}
