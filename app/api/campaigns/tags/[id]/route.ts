/**
 * GET/DELETE /api/campaigns/tags/[id] - Get and delete campaign tag
 */

import { NextRequest, NextResponse } from 'next/server'
import { campaignTagDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params
    const tag = await campaignTagDb.getById(ctx.tenantId, id)

    if (!tag) {
      return NextResponse.json(
        { error: 'Tag não encontrada' },
        { status: 404 }
      )
    }

    return NextResponse.json(tag)
  } catch (error) {
    console.error('[GET /api/campaigns/tags/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { id } = await params

    // Verifica se a tag existe
    const existing = await campaignTagDb.getById(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json(
        { error: 'Tag não encontrada' },
        { status: 404 }
      )
    }

    await campaignTagDb.delete(ctx.tenantId, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/campaigns/tags/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
