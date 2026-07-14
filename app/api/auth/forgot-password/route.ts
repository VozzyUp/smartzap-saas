import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getAppUrl } from '@/lib/app-url'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) return NextResponse.json({ error: 'E-mail é obrigatório' }, { status: 400 })
  const supabase = await createClient()
  // Sucesso opaco sempre — não revela se o e-mail existe.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getAppUrl(request.nextUrl.origin)}/api/auth/callback?next=/reset-password`,
  })
  return NextResponse.json({ success: true })
}
