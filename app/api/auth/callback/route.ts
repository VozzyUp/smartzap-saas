/**
 * Auth Callback API
 *
 * GET: Troca o `code` (confirmação de cadastro ou reset de senha) por uma
 * sessão Supabase e garante que o usuário tenha um tenant provisionado
 * antes de liberar o acesso ao app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { provisionTenantForUser } from '@/lib/tenant-provisioning'
import { getAppUrl } from '@/lib/app-url'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const baseUrl = getAppUrl(request.nextUrl.origin)

  if (!code) {
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('reason', 'missing_code')
    return NextResponse.redirect(loginUrl)
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !data.user) {
      const loginUrl = new URL('/login', baseUrl)
      loginUrl.searchParams.set('reason', 'invalid_code')
      return NextResponse.redirect(loginUrl)
    }

    await provisionTenantForUser(data.user.id, data.user.email ?? data.user.id)

    const nextParam = request.nextUrl.searchParams.get('next')
    // Valida a URL resolvida (não a string): o parser normaliza "\" para "/",
    // então checagem de prefixo na string crua é contornável (/\evil.com).
    let nextPath = '/'
    if (nextParam) {
      const resolved = new URL(nextParam, baseUrl)
      if (resolved.origin === new URL(baseUrl).origin) {
        nextPath = resolved.pathname + resolved.search
      }
    }
    return NextResponse.redirect(new URL(nextPath, baseUrl))
  } catch (error) {
    console.error('Auth callback error:', error)
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('reason', 'callback_error')
    return NextResponse.redirect(loginUrl)
  }
}
