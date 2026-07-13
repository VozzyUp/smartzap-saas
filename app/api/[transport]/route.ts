import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { mcpContextStorage } from '@/lib/mcp/context'
import { registerAllTools } from '@/lib/mcp/index'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Extrai token do header Authorization: Bearer <token> ou X-Api-Key: <token>
function extractToken(request: Request): string {
  const auth = request.headers.get('authorization') ?? ''
  const fromBearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (fromBearer) return fromBearer
  return request.headers.get('x-api-key')?.trim() ?? ''
}

// Fallback: aceita um access token de sessão Supabase (magic link) pertencente
// a um `platform_admin` — MASTER_PASSWORD não é mais aceito aqui (aposentado
// como login de usuário; permanece só como gate do wizard `/install`).
async function resolvePlatformAdminToken(token: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  if (!admin) return false

  try {
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) return false

    const { data: isPlatformAdmin, error: rpcError } = await admin.rpc('is_platform_admin', {
      uid: data.user.id,
    })
    if (rpcError) return false

    return !!isPlatformAdmin
  } catch {
    // Token não é um JWT Supabase válido — ignora e trata como inválido.
    return false
  }
}

// Valida o token e retorna o contexto de admin ou null se inválido
async function resolveToken(token: string): Promise<{ isAdmin: boolean } | null> {
  const adminKey = process.env.SMARTZAP_ADMIN_KEY
  const apiKey = process.env.SMARTZAP_API_KEY

  if (adminKey && token === adminKey) return { isAdmin: true }
  if (apiKey && token === apiKey) return { isAdmin: false }

  // Sessão Supabase de um platform_admin também concede acesso admin.
  if (await resolvePlatformAdminToken(token)) return { isAdmin: true }

  return null
}

const mcpHandler = createMcpHandler(
  (server) => {
    registerAllTools(server)
  },
  undefined,
  {
    basePath: '/api',
    maxDuration: 120,
    verboseLogs: process.env.NODE_ENV === 'development',
  }
)

const authWrappedHandler = withMcpAuth(
  mcpHandler,
  async (req, bearerToken) => {
    const token = bearerToken ?? extractToken(req)
    if (!token) return undefined

    const ctx = await resolveToken(token)
    if (!ctx) return undefined

    // Retorna AuthInfo mínimo compatível. O contexto real fica no AsyncLocalStorage.
    return { token, clientId: ctx.isAdmin ? 'admin' : 'api', scopes: [] }
  },
  { required: true }
)

async function wrappedHandler(request: Request) {
  const token = extractToken(request)

  if (token) {
    const ctx = await resolveToken(token)
    if (ctx) {
      return mcpContextStorage.run(ctx, () => authWrappedHandler(request))
    }
  }

  return authWrappedHandler(request)
}

export {
  wrappedHandler as GET,
  wrappedHandler as POST,
  wrappedHandler as DELETE,
}
