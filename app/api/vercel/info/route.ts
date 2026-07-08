import { NextResponse } from 'next/server'

// Self-hosted: não há dashboard/projeto Vercel para expor informações.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      reason: 'not_applicable_self_hosted',
      message: 'Informações de deployment da Vercel não se aplicam a esta instalação self-hosted.',
    },
    { status: 501 },
  )
}
