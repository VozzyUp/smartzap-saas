/**
 * GET /api/inbox/unread-count - quantidade de conversas abertas com mensagens não lidas
 *
 * A contagem é feita no servidor e SEMPRE filtrada pela conta ativa. Antes o contador da
 * barra lateral consultava o banco direto do navegador, sem tenant_id: um administrador da
 * plataforma (que enxerga todas as contas pelo RLS) via a soma de todas as contas.
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getTenantContext } from '@/lib/tenant-context'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { count, error } = await supabase
    .from('inbox_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'open')
    .gt('unread_count', 0)

  if (error) {
    console.error('[GET /api/inbox/unread-count] Error:', error.message)
    return NextResponse.json({ error: 'Failed to count unread conversations' }, { status: 500 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
