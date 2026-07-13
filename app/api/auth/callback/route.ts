/**
 * Auth Callback API
 *
 * GET: Troca o `code` do magic link por uma sessão Supabase e garante que o
 * usuário tenha um tenant provisionado antes de liberar o acesso ao app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { provisionTenantForUser } from '@/lib/tenant-provisioning'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('reason', 'missing_code')
    return NextResponse.redirect(loginUrl)
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !data.user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('reason', 'invalid_code')
      return NextResponse.redirect(loginUrl)
    }

    await provisionTenantForUser(data.user.id, data.user.email ?? data.user.id)

    return NextResponse.redirect(new URL('/', request.url))
  } catch (error) {
    console.error('Auth callback error:', error)
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('reason', 'callback_error')
    return NextResponse.redirect(loginUrl)
  }
}
