import { NextResponse } from 'next/server'
import { KanbanError } from '@/lib/kanban'

export function statusForKanbanCode(code: KanbanError['code']): number {
  switch (code) {
    case 'card_exists':
    case 'stage_has_cards':
      return 409
    case 'invalid_stage':
      return 400
    case 'not_found':
      return 404
    default:
      return 500
  }
}

export function kanbanErrorResponse(error: unknown, routeLabel: string) {
  if (error instanceof KanbanError) {
    return NextResponse.json({ error: error.code }, { status: statusForKanbanCode(error.code) })
  }
  console.error(`[api/kanban${routeLabel}] erro inesperado:`, error)
  return NextResponse.json({ error: 'internal' }, { status: 500 })
}
