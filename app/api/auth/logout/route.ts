/**
 * Logout API
 *
 * POST: Encerra a sessão Supabase do usuário (login por senha).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Erro ao fazer logout' },
      { status: 500 }
    )
  }
}
