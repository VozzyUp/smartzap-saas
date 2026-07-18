'use client'

/**
 * FunnelStageChip - Chip de fase do funil no inbox
 *
 * Mostra em qual(is) fase(s) de funil o contato da conversa está,
 * com popover para trocar de fase (ou adicionar/remover do funil)
 * sem sair da conversa.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X, GitBranch } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// =============================================================================
// Types (espelham lib/kanban.ts)
// =============================================================================

interface ContactStageInfo {
  boardId: string
  boardName: string
  stageId: string
  stageName: string
  stageColor: string
  cardId: string
}

interface KanbanBoard {
  id: string
  name: string
  position: number
}

interface KanbanStageData {
  id: string
  board_id: string
  name: string
  color: string
  position: number
}

interface KanbanBoardData {
  board: KanbanBoard
  stages: (KanbanStageData & { cards: unknown[] })[]
}

// =============================================================================
// API
// =============================================================================

async function fetchContactStages(contactId: string): Promise<ContactStageInfo[]> {
  const res = await fetch(`/api/kanban/contact/${contactId}/stages`)
  if (!res.ok) throw new Error('Erro ao buscar fases do funil')
  const data = await res.json()
  return data.stages ?? []
}

async function fetchBoards(): Promise<KanbanBoard[]> {
  const res = await fetch('/api/kanban/boards')
  if (!res.ok) throw new Error('Erro ao buscar funis')
  const data = await res.json()
  return data.boards ?? []
}

async function fetchBoardData(boardId: string): Promise<KanbanBoardData> {
  const res = await fetch(`/api/kanban/boards/${boardId}/data`)
  if (!res.ok) throw new Error('Erro ao buscar fases')
  return res.json()
}

async function moveCard(cardId: string, stageId: string): Promise<void> {
  const res = await fetch(`/api/kanban/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stageId, position: 0 }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Erro ao trocar fase')
  }
}

async function removeCard(cardId: string): Promise<void> {
  const res = await fetch(`/api/kanban/cards/${cardId}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Erro ao remover do funil')
  }
}

async function addContactToBoard(boardId: string, contactId: string): Promise<{ error?: string } | null> {
  const res = await fetch(`/api/kanban/boards/${boardId}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId }),
  })
  if (res.status === 409) {
    // card_exists: contato já está no funil, apenas seguimos (invalida e mostra estado atual)
    return { error: 'card_exists' }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Erro ao adicionar ao funil')
  }
  return null
}

// =============================================================================
// Change stage popover (contato já está em pelo menos um funil)
// =============================================================================

function ChangeStagePopover({
  stage,
  contactId,
  onClose,
}: {
  stage: ContactStageInfo
  contactId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const { data: boardData, isLoading } = useQuery({
    queryKey: ['kanban-board-data', stage.boardId],
    queryFn: () => fetchBoardData(stage.boardId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['contact-stages', contactId] })
  }

  const moveMutation = useMutation({
    mutationFn: (stageId: string) => moveCard(stage.cardId, stageId),
    onSuccess: () => {
      invalidate()
      toast.success('Fase atualizada')
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const removeMutation = useMutation({
    mutationFn: () => removeCard(stage.cardId),
    onSuccess: () => {
      invalidate()
      toast.success('Removido do funil')
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  return (
    <div className="p-2 w-56">
      <p className="text-[10px] font-medium text-[var(--ds-text-muted)] px-1.5 pb-1.5 truncate">
        {stage.boardName}
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--ds-text-muted)]" />
        </div>
      ) : (
        <div className="space-y-0.5 max-h-56 overflow-y-auto">
          {(boardData?.stages ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => moveMutation.mutate(s.id)}
              disabled={moveMutation.isPending || s.id === stage.stageId}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors',
                s.id === stage.stageId
                  ? 'bg-[var(--ds-bg-surface)] text-[var(--ds-text-primary)]'
                  : 'hover:bg-[var(--ds-bg-hover)] text-[var(--ds-text-secondary)]'
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate">{s.name}</span>
              {s.id === stage.stageId && (
                <span className="ml-auto text-[9px] text-[var(--ds-text-muted)]">atual</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="border-t border-[var(--ds-border-subtle)] mt-1.5 pt-1.5">
        <button
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
        >
          {removeMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          Remover do funil
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Add to funnel popover (contato ainda não está em nenhum funil)
// =============================================================================

function AddToFunnelPopover({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const queryClient = useQueryClient()

  const { data: boards, isLoading } = useQuery({
    queryKey: ['kanban-boards'],
    queryFn: fetchBoards,
  })

  const addMutation = useMutation({
    mutationFn: (boardId: string) => addContactToBoard(boardId, contactId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['contact-stages', contactId] })
      if (result?.error === 'card_exists') {
        toast.info('Contato já está nesse funil')
      } else {
        toast.success('Adicionado ao funil')
      }
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  return (
    <div className="p-2 w-56">
      <p className="text-[10px] font-medium text-[var(--ds-text-muted)] px-1.5 pb-1.5">
        Adicionar a um funil
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--ds-text-muted)]" />
        </div>
      ) : (boards ?? []).length === 0 ? (
        <p className="text-xs text-[var(--ds-text-muted)] px-1.5 py-2">Nenhum funil criado ainda</p>
      ) : (
        <div className="space-y-0.5 max-h-56 overflow-y-auto">
          {(boards ?? []).map((board) => (
            <button
              key={board.id}
              onClick={() => addMutation.mutate(board.id)}
              disabled={addMutation.isPending}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] transition-colors disabled:opacity-50"
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{board.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export interface FunnelStageChipProps {
  contactId: string | null
}

export function FunnelStageChip({ contactId }: FunnelStageChipProps) {
  const [openStageId, setOpenStageId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const { data: stages } = useQuery({
    queryKey: ['contact-stages', contactId],
    queryFn: () => fetchContactStages(contactId as string),
    enabled: !!contactId,
  })

  if (!contactId) return null

  if (!stages || stages.length === 0) {
    return (
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button className="h-5 px-1.5 rounded-full text-[9px] font-medium flex items-center gap-1 border border-dashed border-[var(--ds-border-subtle)] text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] transition-colors">
            <Plus className="h-2.5 w-2.5" />
            Funil
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-0">
          <AddToFunnelPopover contactId={contactId} onClose={() => setAddOpen(false)} />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((stage) => (
        <Popover
          key={stage.cardId}
          open={openStageId === stage.cardId}
          onOpenChange={(open) => setOpenStageId(open ? stage.cardId : null)}
        >
          <PopoverTrigger asChild>
            <button
              className="h-5 px-1.5 rounded-full text-[9px] font-medium flex items-center gap-1 max-w-[160px] border transition-colors hover:brightness-110"
              style={{
                borderColor: stage.stageColor,
                color: stage.stageColor,
                backgroundColor: `${stage.stageColor}1a`,
              }}
              title={`${stage.boardName}: ${stage.stageName}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: stage.stageColor }}
              />
              <span className="truncate">
                {stage.boardName}: {stage.stageName}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-0">
            <ChangeStagePopover
              stage={stage}
              contactId={contactId}
              onClose={() => setOpenStageId(null)}
            />
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}
