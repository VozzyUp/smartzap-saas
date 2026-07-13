import { NextResponse } from 'next/server'
import { templateProjectDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const ctx = await getTenantContext()
        if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        const { id } = await params
        const updates = await request.json()
        const item = await templateProjectDb.updateItem(ctx.tenantId, id, updates)
        return NextResponse.json(item)
    } catch (error) {
        console.error('Failed to update template project item:', error)
        return NextResponse.json(
            { error: 'Failed to update template project item' },
            { status: 500 }
        )
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const ctx = await getTenantContext()
        if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        const { id } = await params
        await templateProjectDb.deleteItem(ctx.tenantId, id)
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to delete template project item:', error)
        return NextResponse.json(
            { error: 'Failed to delete template project item' },
            { status: 500 }
        )
    }
}
