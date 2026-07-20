/**
 * T021, T022: GET/PATCH/DELETE /api/inbox/conversations/[id]
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getConversation, patchConversation, deleteConversation } from '@/lib/inbox/inbox-service'
import { getTenantContext } from '@/lib/tenant-context'

const patchSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  mode: z.enum(['bot', 'human']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  ai_agent_id: z.string().uuid().optional(),
  labels: z.array(z.string().uuid()).optional(),
})

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { id } = await params

    const conversation = await getConversation(ctx.tenantId, id)

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(conversation)
  } catch (error) {
    console.error('[GET /api/inbox/conversations/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { id } = await params
    const body = await request.json()

    const parsed = patchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const conversation = await patchConversation(ctx.tenantId, id, parsed.data)

    return NextResponse.json(conversation)
  } catch (error) {
    console.error('[PATCH /api/inbox/conversations/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { id } = await params

    await deleteConversation(ctx.tenantId, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/inbox/conversations/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
