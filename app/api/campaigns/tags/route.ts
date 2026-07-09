/**
 * GET/POST /api/campaigns/tags - List and create campaign tags
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { campaignTagDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

const postSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#6B7280'),
})

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const tags = await campaignTagDb.getAll(ctx.tenantId)
    return NextResponse.json(tags)
  } catch (error) {
    console.error('[GET /api/campaigns/tags]', error)
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

    const tag = await campaignTagDb.create(ctx.tenantId, parsed.data)

    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    console.error('[POST /api/campaigns/tags]', error)

    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'Já existe uma tag com este nome' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
