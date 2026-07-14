/**
 * Auth Status API
 *
 * GET: Check current auth status (setup complete? authenticated? configured?)
 *
 * "Autenticado" agora significa "tem sessão Supabase válida" (login por
 * senha) — ver `proxy.ts` e `app/api/auth/{login,callback}`. MASTER_PASSWORD não
 * é mais um mecanismo de login de usuário (permanece só como gate do wizard
 * `/install`, fora do escopo desta rota).
 */

import { NextResponse } from 'next/server'
import { getUserAuthStatus } from '@/lib/user-auth-status'

// Este endpoint controla redirects do login.
// No Edge, env vars/SDK podem se comportar diferente e fazer isSetup/isAuthenticated
// voltarem como false, gerando loop para o wizard.
export const runtime = 'nodejs'

// Evita cache/stale data (status de sessão/setup precisa ser sempre atual)
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const isProd = process.env.NODE_ENV === 'production'
    const log = (...args: any[]) => {
      if (!isProd) console.log(...args)
    }

    log('🔍 [AUTH-STATUS] === START ===')

    const status = await getUserAuthStatus()

    log('🔍 [AUTH-STATUS] getUserAuthStatus result:', JSON.stringify(status, null, 2))

    const response = {
      isConfigured: status.isConfigured,
      isSetup: status.isSetup,
      isAuthenticated: status.isAuthenticated,
      company: status.company
    }

    log('🔍 [AUTH-STATUS] Final response:', JSON.stringify(response, null, 2))
    return NextResponse.json(response)
  } catch (error) {
    console.error('Auth status error:', error)
    return NextResponse.json(
      { error: 'Failed to check auth status' },
      { status: 500 }
    )
  }
}
