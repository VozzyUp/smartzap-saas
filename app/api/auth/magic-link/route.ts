/**
 * Magic Link API
 *
 * POST: Envia um link de login (OTP) por email via Supabase Auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getAppUrl } from '@/lib/app-url'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim() : ''

    if (!email) {
      return NextResponse.json(
        { error: 'Email é obrigatório' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${getAppUrl(request.nextUrl.origin)}/api/auth/callback`,
      },
    })

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Erro ao enviar link de acesso' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Magic link error:', error)
    return NextResponse.json(
      { error: 'Erro ao enviar link de acesso' },
      { status: 500 }
    )
  }
}
