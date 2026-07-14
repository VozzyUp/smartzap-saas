import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getAppUrl } from '@/lib/app-url'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || password.length < 8) {
    return NextResponse.json({ error: 'E-mail válido e senha com no mínimo 8 caracteres' }, { status: 400 })
  }
  const supabase = await createClient()
  // Resposta sempre opaca (anti-enumeração): erros de "já cadastrado" não vazam.
  await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: `${getAppUrl(request.nextUrl.origin)}/api/auth/callback` },
  })
  return NextResponse.json({ success: true })
}
