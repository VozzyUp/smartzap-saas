/**
 * Ambiente lógico da aplicação. Substitui process.env.VERCEL_ENV.
 * Prioridade: APP_ENV → NODE_ENV. Qualquer valor != 'production' é não-produção.
 */
export function getAppEnv(): 'production' | 'development' {
  const raw = (process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase()
  return raw === 'production' ? 'production' : 'development'
}

export function isProduction(): boolean {
  return getAppEnv() === 'production'
}
