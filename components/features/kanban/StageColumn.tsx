'use client'

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreVertical, Pencil, Trash2, Palette, Check, Clock3 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { updateStage, deleteStage } from './api'
import { ContactCard } from './ContactCard'
import { FollowupRulesEditor } from './FollowupRulesEditor'
import { STAGE_COLORS, type KanbanStageWithCards } from './types'

interface StageColumnProps {
  boardId: string
  stage: KanbanStageWithCards
}

export function StageColumn({ boardId, stage }: StageColumnProps) {
  const queryClient = useQueryClient()
  const [isRenaming, setIsRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(stage.name)
  const [isFollowupOpen, setIsFollowupOpen] = useState(false)

  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { type: 'stage', stageId: stage.id },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['kanban-board-data', boardId] })

  const renameMutation = useMutation({
    mutationFn: (name: string) => updateStage(stage.id, { name }),
    onSuccess: () => {
      invalidate()
      setIsRenaming(false)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao renomear fase')
    },
  })

  const colorMutation = useMutation({
    mutationFn: (color: string) => updateStage(stage.id, { color }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao mudar cor da fase')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteStage(stage.id),
    onSuccess: () => {
      toast.success('Fase excluída')
      invalidate()
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.body && (error.body as any).error === 'stage_has_cards') {
        toast.error('Mova os clientes antes de excluir esta fase')
        return
      }
      toast.error(error instanceof Error ? error.message : 'Erro ao excluir fase')
    },
  })

  const handleRenameSubmit = () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === stage.name) {
      setIsRenaming(false)
      setNameDraft(stage.name)
      return
    }
    renameMutation.mutate(trimmed)
  }

  const handleDelete = () => {
    if (stage.cards.length > 0) {
      toast.error('Mova os clientes antes de excluir esta fase')
      return
    }
    if (confirm(`Excluir a fase "${stage.name}"?`)) {
      deleteMutation.mutate()
    }
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-2xl border border-[var(--ds-border-subtle)] bg-[var(--ds-bg-surface)]">
      <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-[var(--ds-border-subtle)]">
        <div className="flex min-w-0 items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: stage.color }}
                aria-label="Mudar cor da fase"
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <div className="grid grid-cols-4 gap-1.5">
                {STAGE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => colorMutation.mutate(color)}
                    className="flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: color }}
                    aria-label={`Usar cor ${color}`}
                  >
                    {stage.color === color && <Check size={12} className="text-white" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {isRenaming ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') {
                  setIsRenaming(false)
                  setNameDraft(stage.name)
                }
              }}
              className="h-7 text-sm"
            />
          ) : (
            <span className="truncate text-sm font-medium text-[var(--ds-text-primary)]">{stage.name}</span>
          )}

          <span className="shrink-0 rounded-full bg-[var(--ds-bg-muted)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ds-text-muted)]">
            {stage.cards.length}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-muted)] hover:text-[var(--ds-text-primary)]"
              aria-label="Opções da fase"
            >
              <MoreVertical size={16} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setNameDraft(stage.name)
                setIsRenaming(true)
              }}
            >
              <Pencil size={14} aria-hidden="true" />
              Renomear
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIsFollowupOpen(true)}>
              <Clock3 size={14} aria-hidden="true" />
              Follow-up automático
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
              <Trash2 size={14} aria-hidden="true" />
              Excluir fase
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <FollowupRulesEditor
        stageId={stage.id}
        stageName={stage.name}
        open={isFollowupOpen}
        onOpenChange={setIsFollowupOpen}
      />

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 space-y-2 overflow-y-auto p-3 min-h-[80px]',
          isOver && 'bg-[var(--ds-bg-muted)]/50'
        )}
      >
        <SortableContext items={stage.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {stage.cards.map((card) => (
            <ContactCard key={card.id} card={card} />
          ))}
        </SortableContext>
        {stage.cards.length === 0 && (
          <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-[var(--ds-border-subtle)] text-xs text-[var(--ds-text-muted)]">
            Arraste um cliente aqui
          </div>
        )}
      </div>
    </div>
  )
}
