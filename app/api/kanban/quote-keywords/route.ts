import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listQuoteKeywords, addQuoteKeyword } from '@/lib/kanban-automation'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const keywords = await listQuoteKeywords(ctx.tenantId)
  return NextResponse.json({ keywords })
}

export async function POST(request: Request) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
  if (!keyword) {
    return NextResponse.json({ error: 'keyword é obrigatório' }, { status: 400 })
  }

  const created = await addQuoteKeyword(ctx.tenantId, keyword)
  return NextResponse.json({ keyword: created })
}
