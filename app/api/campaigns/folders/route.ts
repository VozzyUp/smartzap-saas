/**
 * GET/POST /api/campaigns/folders - List and create campaign folders
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { campaignFolderDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

const postSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#6B7280'),
})

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Retorna folders com contagem de campanhas
    const folders = await campaignFolderDb.getAllWithCounts(ctx.tenantId)
    const totalCount = await campaignFolderDb.getTotalCount(ctx.tenantId)
    const unfiledCount = await campaignFolderDb.getUnfiledCount(ctx.tenantId)

    return NextResponse.json({
      folders,
      totalCount,
      unfiledCount,
    })
  } catch (error) {
    console.error('[GET /api/campaigns/folders]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await request.json()

    const parsed = postSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const folder = await campaignFolderDb.create(ctx.tenantId, parsed.data)

    return NextResponse.json(folder, { status: 201 })
  } catch (error) {
    console.error('[POST /api/campaigns/folders]', error)

    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'Já existe uma pasta com este nome' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
