import type { KanbanBoard, KanbanStage, KanbanCard } from '@/lib/kanban'

export type { KanbanBoard, KanbanStage, KanbanCard }

export type KanbanCardWithContact = KanbanCard & {
  contact: { id: string; name: string | null; phone: string | null }
}

export type KanbanStageWithCards = KanbanStage & {
  cards: KanbanCardWithContact[]
}

export type KanbanBoardData = {
  board: KanbanBoard
  stages: KanbanStageWithCards[]
}

/** Paleta fixa de cores para fases (estilo etiquetas do WhatsApp). */
export const STAGE_COLORS = [
  '#3b82f6', // azul
  '#f59e0b', // âmbar
  '#22c55e', // verde
  '#ef4444', // vermelho
  '#a855f7', // roxo
  '#ec4899', // rosa
  '#14b8a6', // teal
  '#64748b', // slate
] as const
