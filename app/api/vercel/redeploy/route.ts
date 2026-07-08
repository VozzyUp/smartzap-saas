import { NextResponse } from 'next/server'

// Self-hosted: redeploy é feito via Portainer/CI, não pela API da Vercel.
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      reason: 'not_applicable_self_hosted',
      message: 'Redeploy é gerenciado pelo Portainer/CI nesta instalação.',
    },
    { status: 501 },
  )
}
