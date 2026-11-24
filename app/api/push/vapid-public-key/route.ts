/**
 * GET /api/push/vapid-public-key - chave pública VAPID lida em tempo de execução
 *
 * A imagem é montada no GitHub, sem as chaves; NEXT_PUBLIC_* só entra no pacote do navegador
 * no momento do build. Esta rota entrega a chave pública (não é segredo) a partir das variáveis
 * do servidor, para o navegador conseguir se inscrever nas notificações.
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || ''
  if (!publicKey) {
    return NextResponse.json({ error: 'VAPID não configurado' }, { status: 503 })
  }
  return NextResponse.json({ publicKey })
}
