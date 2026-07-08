import { NextResponse } from 'next/server'

// Self-hosted: gestão/descoberta de domínios agora é feita via DNS/Traefik,
// não pela detecção automática de domínios da Vercel.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      reason: 'not_applicable_self_hosted',
      message: 'Gestão de domínios é feita via DNS/Traefik nesta instalação self-hosted.',
    },
    { status: 501 },
  )
}
