import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import {
    verifyApiKey,
    verifyAdminAccess,
    isAdminEndpoint,
    isPublicEndpoint,
    unauthorizedResponse,
    forbiddenResponse
} from '@/lib/auth'
import { provisionTenantForUser } from '@/lib/tenant-provisioning'
import { getAppUrl } from '@/lib/app-url'

export const config = {
    matcher: [
        // Match all pages except static files and _next
        // Includes: .json (manifest.json), .js (sw.js), common images/audio, and Next.js internals
        '/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|wav|ogg|m4a|yaml|yml)$).*)',
    ],
}

// Routes that don't require user authentication
const PUBLIC_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password', '/trial-expirado', '/install', '/debug-auth', '/f', '/atendimento', '/docs']
// Rotas que NÃO precisam de autenticação
// CUIDADO: adicionar rotas aqui expõe elas publicamente!
const PUBLIC_API_ROUTES = [
    '/api/auth',              // Login/logout/status/forgot-password/callback
    '/api/webhook',           // Meta WhatsApp webhooks (usa HMAC)
    '/api/health',            // Health checks
    '/api/system',            // Info básica do sistema
    '/api/installer',         // Setup inicial (protegido separadamente após install)
    '/api/campaign/workflow', // Chamado internamente pelo QStash
    '/api/public',            // Rotas explicitamente públicas (lead forms, etc)
]

type SupabaseCookie = { name: string; value: string; options: CookieOptions }

type SessionInfo = {
    user: { id: string; email?: string | null } | null
    tenantId: string | null
    cookiesToSet: SupabaseCookie[]
}

const EMPTY_SESSION: SessionInfo = { user: null, tenantId: null, cookiesToSet: [] }

/**
 * Lê a sessão Supabase a partir dos cookies da requisição (via @supabase/ssr).
 * Quando há usuário mas nenhum tenant associado ainda (primeiro login via
 * magic link), provisiona o tenant inline — o proxy roda em runtime Node.js,
 * então é seguro chamar provisionTenantForUser (usa a service role key).
 */
async function resolveSession(request: NextRequest): Promise<SessionInfo> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const publishableKey =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

    if (!url || !publishableKey) {
        return EMPTY_SESSION
    }

    let cookiesToSet: SupabaseCookie[] = []

    const supabase = createServerClient(url, publishableKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll()
            },
            setAll(cookies) {
                cookiesToSet = cookies
            },
        },
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { user: null, tenantId: null, cookiesToSet }
    }

    const { data: currentTenantId } = await supabase.rpc('current_tenant_id')
    let tenantId = (currentTenantId as string | null) ?? null

    if (!tenantId) {
        try {
            const provisioned = await provisionTenantForUser(user.id, user.email ?? user.id)
            tenantId = provisioned.tenantId
        } catch (err) {
            console.error('[proxy] Falha ao provisionar tenant para', user.id, err)
        }
    }

    return { user: { id: user.id, email: user.email }, tenantId, cookiesToSet }
}

/**
 * Monta a resposta final (next() ou redirect) aplicando cookies atualizados
 * do Supabase (refresh de token) e injetando o header x-tenant-id quando
 * há um tenant resolvido para a requisição.
 */
function buildResponse(
    request: NextRequest,
    session: SessionInfo,
    redirectTo?: URL,
): NextResponse {
    let response: NextResponse

    if (redirectTo) {
        response = NextResponse.redirect(redirectTo)
    } else {
        const headers = new Headers(request.headers)
        if (session.tenantId) {
            headers.set('x-tenant-id', session.tenantId)
        }
        response = NextResponse.next({ request: { headers } })
    }

    session.cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
    })

    return response
}

export async function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname

    // Lazily resolved (and memoized) Supabase session — a única checagem de
    // sessão feita por requisição, reaproveitada em todos os branches abaixo.
    let sessionPromise: Promise<SessionInfo> | null = null
    const getSession = () => {
        if (!sessionPromise) sessionPromise = resolveSession(request)
        return sessionPromise
    }

    // Handle OPTIONS requests for CORS preflight.
    // Alguns scripts (ex.: Vercel feedback/toolbar) disparam OPTIONS/HEAD mesmo em páginas.
    // Deixar isso cair no roteamento padrão pode virar 400 e poluir o console.
    if (request.method === 'OPTIONS') {
        const origin = request.headers.get('origin')
        const reqHeaders = request.headers.get('access-control-request-headers')

        return new NextResponse(null, {
            status: 204,
            headers: {
                ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
                'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
                'Access-Control-Allow-Headers': reqHeaders || 'Content-Type, Authorization',
                ...(origin ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
                'Access-Control-Max-Age': '86400',
                'Vary': 'Origin, Access-Control-Request-Headers',
            },
        })
    }

    // ==========================================================================
    // BOOTSTRAP CHECK - Redirect to installer if not configured
    // ==========================================================================
    const hasMasterPassword = !!process.env.MASTER_PASSWORD

    // ==========================================================================
    // INSTALLER LOCKDOWN (produção)
    // - Após a instalação, ninguém "anônimo" deveria conseguir abrir o wizard
    // - As APIs do installer também não devem ficar abertas após concluído
    //   (exceto com sessão ou admin key)
    // ==========================================================================
    // Em produção, se já existe MASTER_PASSWORD, o installer não pode ser público.
    // Isso protege mesmo quando INSTALLER_ENABLED não estiver setado corretamente.
    const shouldLockInstaller = process.env.NODE_ENV === 'production' && hasMasterPassword
    const isInstallerPage = pathname === '/install' || pathname.startsWith('/install/')
    const isInstallerApi = pathname.startsWith('/api/installer')

    if (shouldLockInstaller && (isInstallerPage || isInstallerApi)) {
        // Para páginas: exige sessão (login)
        if (isInstallerPage) {
            const session = await getSession()
            if (!session.user) {
                const loginUrl = new URL('/login', getAppUrl(request.nextUrl.origin))
                loginUrl.searchParams.set('reason', 'installer_locked')
                loginUrl.searchParams.set('redirect', pathname)
                return buildResponse(request, session, loginUrl)
            }
        }

        // Para APIs: permite sessão OU admin key
        if (isInstallerApi) {
            const session = await getSession()
            if (session.user) {
                return buildResponse(request, session)
            }

            const adminAuth = await verifyAdminAccess(request)
            if (!adminAuth.valid) {
                return unauthorizedResponse('Installer API bloqueada após instalação. Faça login ou use SMARTZAP_ADMIN_KEY.')
            }
            return NextResponse.next()
        }
    }

    // If not configured and not already on install, redirect immediately
    if (!hasMasterPassword) {
        if (!pathname.startsWith('/install') && !pathname.startsWith('/api')) {
            const installUrl = new URL('/install', getAppUrl(request.nextUrl.origin))
            return NextResponse.redirect(installUrl)
        }
    }

    // If configured but install not complete, go to wizard.
    // IMPORTANT:
    // - Não force o wizard aqui. Em dev/local, a completude da instalação pode ser detectada via DB,
    //   enquanto INSTALLER_ENABLED é uma env que controla se o installer está disponível.
    // - Para ser mais "à prova de falhas", sempre deixe o usuário cair em /login quando não houver
    //   sessão, e deixe o /login decidir (via /api/auth/status) se precisa mandar para o wizard.
    // - Se existir sessão Supabase válida, deixa passar.
    //
    // Obs: o redirect para /login já é feito mais abaixo para páginas protegidas.

    // ==========================================================================
    // API Routes - Use API Key authentication
    // ==========================================================================
    if (pathname.startsWith('/api/')) {
        // Auth endpoints are always public
        if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
            return NextResponse.next()
        }

        // Public endpoints don't require authentication
        if (isPublicEndpoint(pathname)) {
            return NextResponse.next()
        }

        // Admin endpoints require admin-level access
        if (isAdminEndpoint(pathname)) {
            const adminAuth = await verifyAdminAccess(request)

            if (!adminAuth.valid) {
                return adminAuth.error?.includes('Admin')
                    ? forbiddenResponse(adminAuth.error)
                    : unauthorizedResponse(adminAuth.error)
            }

            return NextResponse.next()
        }

        // Check for user session (for browser API calls)
        const session = await getSession()
        if (session.user) {
            // Session exists, allow request (validation happens in API route)
            return buildResponse(request, session)
        }

        // All other API endpoints require at least API key
        const authResult = await verifyApiKey(request)

        if (!authResult.valid) {
            return unauthorizedResponse(authResult.error)
        }

        return NextResponse.next()
    }

    // ==========================================================================
    // Page Routes - Use Supabase session authentication
    // ==========================================================================

    // Public pages don't require authentication
    if (PUBLIC_PAGES.some(page => pathname.startsWith(page))) {
        return NextResponse.next()
    }

    const session = await getSession()

    // No valid session - redirect to login
    if (!session.user) {
        const loginUrl = new URL('/login', getAppUrl(request.nextUrl.origin))
        loginUrl.searchParams.set('redirect', pathname)
        return buildResponse(request, session, loginUrl)
    }

    // Session exists - allow access with x-tenant-id injected
    return buildResponse(request, session)
}
