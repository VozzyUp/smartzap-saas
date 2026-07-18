'use client'

import { useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getBoardData, moveCard } from './api'
import { ContactCard } from './ContactCard'
import { StageColumn } from './StageColumn'
import { NewStageColumn } from './NewStageColumn'
import { AddCardDialog } from './AddCardDialog'
import type { KanbanBoardData, KanbanCardWithContact } from './types'

const QUERY_KEY = (boardId: string) => ['kanban-board-data', boardId] as const

export function KanbanBoardView({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient()
  const [activeCard, setActiveCard] = useState<KanbanCardWithContact | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const snapshotRef = useRef<KanbanBoardData | undefined>(undefined)

  const { data, isLoading } = useQuery<KanbanBoardData>({
    queryKey: QUERY_KEY(boardId),
    queryFn: () => getBoardData(boardId),
  })

  const stages = data?.stages ?? []

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const moveMutation = useMutation({
    mutationFn: (vars: { cardId: string; stageId: string; position: number }) =>
      moveCard(vars.cardId, { stageId: vars.stageId, position: vars.position }),
    onError: () => {
      toast.error('Não foi possível mover o cliente. Tente novamente.')
      if (snapshotRef.current) {
        queryClient.setQueryData(QUERY_KEY(boardId), snapshotRef.current)
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY(boardId) })
    },
  })

  function findStageIdByCard(current: KanbanBoardData | undefined, cardId: string): string | undefined {
    return current?.stages.find((s) => s.cards.some((c) => c.id === cardId))?.id
  }

  function handleDragStart(event: DragStartEvent) {
    const cardId = String(event.active.id)
    const current = queryClient.getQueryData<KanbanBoardData>(QUERY_KEY(boardId))
    snapshotRef.current = current
    const stage = current?.stages.find((s) => s.cards.some((c) => c.id === cardId))
    setActiveCard(stage?.cards.find((c) => c.id === cardId) ?? null)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const current = queryClient.getQueryData<KanbanBoardData>(QUERY_KEY(boardId))
    if (!current) return

    const activeStageId = findStageIdByCard(current, activeId)
    const overStageId =
      findStageIdByCard(current, overId) ?? (current.stages.some((s) => s.id === overId) ? overId : undefined)
    if (!activeStageId || !overStageId || activeStageId === overStageId) return

    queryClient.setQueryData<KanbanBoardData>(QUERY_KEY(boardId), (old) => {
      if (!old) return old
      const activeStage = old.stages.find((s) => s.id === activeStageId)
      const overStage = old.stages.find((s) => s.id === overStageId)
      if (!activeStage || !overStage) return old
      const activeIndex = activeStage.cards.findIndex((c) => c.id === activeId)
      if (activeIndex === -1) return old
      const movingCard = activeStage.cards[activeIndex]
      const overIndex = overStage.cards.findIndex((c) => c.id === overId)
      const insertIndex = overIndex >= 0 ? overIndex : overStage.cards.length

      return {
        ...old,
        stages: old.stages.map((s) => {
          if (s.id === activeStageId) {
            return { ...s, cards: s.cards.filter((c) => c.id !== activeId) }
          }
          if (s.id === overStageId) {
            const newCards = [...s.cards]
            newCards.splice(insertIndex, 0, { ...movingCard, stage_id: overStageId })
            return { ...s, cards: newCards }
          }
          return s
        }),
      }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)

    const current = queryClient.getQueryData<KanbanBoardData>(QUERY_KEY(boardId))
    if (!current) return

    const activeStageId = findStageIdByCard(current, activeId)
    if (!activeStageId) return
    const overStageId =
      findStageIdByCard(current, overId) ?? (current.stages.some((s) => s.id === overId) ? overId : activeStageId)

    let finalPosition = 0

    queryClient.setQueryData<KanbanBoardData>(QUERY_KEY(boardId), (old) => {
      if (!old) return old
      const stage = old.stages.find((s) => s.id === activeStageId)
      if (!stage) return old
      const activeIndex = stage.cards.findIndex((c) => c.id === activeId)
      if (activeIndex === -1) return old
      const overIndex = stage.cards.findIndex((c) => c.id === overId)

      let newStages = old.stages
      if (activeStageId === overStageId && overIndex >= 0 && activeIndex !== overIndex) {
        newStages = old.stages.map((s) =>
          s.id === activeStageId ? { ...s, cards: arrayMove(s.cards, activeIndex, overIndex) } : s
        )
      }

      const finalStage = newStages.find((s) => s.id === activeStageId)!
      finalPosition = finalStage.cards.findIndex((c) => c.id === activeId)

      return { ...old, stages: newStages }
    })

    moveMutation.mutate({ cardId: activeId, stageId: activeStageId, position: finalPosition })
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--ds-text-muted)]">
        <Loader2 className="animate-spin" size={24} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-end">
        <Button size="sm" onClick={() => setIsAddOpen(true)}>
          <UserPlus size={14} className="mr-1.5" aria-hidden="true" />
          Adicionar cliente
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn key={stage.id} boardId={boardId} stage={stage} />
          ))}
          <NewStageColumn boardId={boardId} />
        </div>

        <DragOverlay>{activeCard && <ContactCard card={activeCard} overlay />}</DragOverlay>
      </DndContext>

      <AddCardDialog boardId={boardId} open={isAddOpen} onOpenChange={setIsAddOpen} />
    </div>
  )
}
