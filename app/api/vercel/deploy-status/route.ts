import { NextResponse } from 'next/server'

/**
 * GET /api/vercel/deploy-status?deploymentId=xxx
 *
 * Self-hosted: não há deployments da Vercel para consultar status.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      reason: 'not_applicable_self_hosted',
      message: 'Consulta de status de deployment da Vercel não se aplica a esta instalação self-hosted.',
    },
    { status: 501 },
  )
}
