import { NextResponse } from 'next/server'
import { customFieldDefDb } from '@/lib/supabase-db'
import { getTenantContext } from '@/lib/tenant-context'

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const ctx = await getTenantContext()
        if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        const { id } = await params
        await customFieldDefDb.delete(ctx.tenantId, id)
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Failed to delete custom field:', error)
        return NextResponse.json(
            { error: 'Falha ao deletar campo personalizado' },
            { status: 500 }
        )
    }
}
