import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8) {
    return NextResponse.json({ error: 'Senha com no mínimo 8 caracteres' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return NextResponse.json({ error: 'Não foi possível atualizar a senha' }, { status: 400 })
  return NextResponse.json({ success: true })
}
