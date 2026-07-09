import { NextResponse } from 'next/server'
import { campaignDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

// Force dynamic rendering (no caching)
export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * POST /api/campaigns/[id]/clone
 * Alias for "duplicate": clone a campaign as a DRAFT.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params

    const cloned = await campaignDb.duplicate(ctx.tenantId, id)
    if (!cloned) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }

    return NextResponse.json(cloned, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Failed to clone campaign:', error)
    return NextResponse.json(
      { error: 'Falha ao clonar campanha', details: (error as Error).message },
      { status: 500 }
    )
  }
}
