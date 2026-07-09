import { NextRequest, NextResponse } from 'next/server'
import { contactDb } from '@/lib/supabase-db'
import { requireSessionOrApiKey } from '@/lib/request-auth'
import { getTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/contacts/tags
 * Lista tags existentes (derivadas dos contatos)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireSessionOrApiKey(request)
    if (auth) return auth

    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const tags = await contactDb.getTags(ctx.tenantId)
    return NextResponse.json(tags, {
      headers: {
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (error) {
    console.error('Failed to fetch tags:', error)
    return NextResponse.json({ error: 'Falha ao buscar tags' }, { status: 500 })
  }
}
