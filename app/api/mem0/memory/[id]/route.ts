/**
 * Mem0 Single Memory API - Gerencia uma memória específica
 *
 * DELETE - Apaga uma memória específica por ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { deleteMemoryById, isMem0EnabledAsync } from '@/lib/ai/mem0-client'
import { getTenantContext } from '@/lib/tenant-context'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

    const { id } = await params

    if (!id) {
      return NextResponse.json({ ok: false, error: 'ID é obrigatório' }, { status: 400 })
    }

    const enabled = await isMem0EnabledAsync(ctx.tenantId)
    if (!enabled) {
      return NextResponse.json({
        ok: false,
        error: 'Mem0 não está habilitado',
      }, { status: 400 })
    }

    const success = await deleteMemoryById(ctx.tenantId, id)

    if (!success) {
      return NextResponse.json({
        ok: false,
        error: 'Falha ao deletar memória',
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Memória deletada',
    })
  } catch (error) {
    console.error('[mem0 memory] DELETE error:', error)
    return NextResponse.json({
      ok: false,
      error: 'Falha ao deletar memória',
    }, { status: 500 })
  }
}
