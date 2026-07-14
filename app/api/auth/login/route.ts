import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'E-mail e senha são obrigatórios' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    return NextResponse.json({ error: 'E-mail ou senha inválidos' }, { status: 401 })
  }
  return NextResponse.json({ success: true })
}
