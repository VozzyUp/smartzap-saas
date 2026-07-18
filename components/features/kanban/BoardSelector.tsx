'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Check, Plus, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createBoard, renameBoard, deleteBoard } from './api'
import type { KanbanBoard } from './types'

interface BoardSelectorProps {
  boards: KanbanBoard[]
  selectedBoard: KanbanBoard | null
  onSelect: (boardId: string) => void
  onCreated: (boardId: string) => void
  onDeleted: () => void
}

export function BoardSelector({ boards, selectedBoard, onSelect, onCreated, onDeleted }: BoardSelectorProps) {
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const createMutation = useMutation({
    mutationFn: (name: string) => createBoard(name),
    onSuccess: (board) => {
      toast.success('Funil criado')
      queryClient.invalidateQueries({ queryKey: ['kanban-boards'] })
      onCreated(board.id)
      setIsCreateOpen(false)
      setNameDraft('')
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar funil')
    },
  })

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameBoard(selectedBoard!.id, name),
    onSuccess: () => {
      toast.success('Funil renomeado')
      queryClient.invalidateQueries({ queryKey: ['kanban-boards'] })
      setIsRenameOpen(false)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao renomear funil')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteBoard(selectedBoard!.id),
    onSuccess: () => {
      toast.success('Funil excluído')
      queryClient.invalidateQueries({ queryKey: ['kanban-boards'] })
      onDeleted()
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao excluir funil')
    },
  })

  const handleDelete = () => {
    if (!selectedBoard) return
    if (confirm(`Excluir o funil "${selectedBoard.name}"? Essa ação não pode ser desfeita.`)) {
      deleteMutation.mutate()
    }
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-w-[180px] justify-between">
            <span className="truncate">{selectedBoard?.name ?? 'Selecionar funil'}</span>
            <ChevronDown size={14} className="ml-2 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          {boards.map((board) => (
            <DropdownMenuItem key={board.id} onSelect={() => onSelect(board.id)}>
              {board.id === selectedBoard?.id && <Check size={14} aria-hidden="true" />}
              <span className="truncate">{board.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setIsCreateOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            Novo funil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedBoard && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-md p-2 text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-muted)] hover:text-[var(--ds-text-primary)]"
              aria-label="Opções do funil"
            >
              <MoreVertical size={16} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setNameDraft(selectedBoard.name)
                setIsRenameOpen(true)
              }}
            >
              <Pencil size={14} aria-hidden="true" />
              Renomear funil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
              <Trash2 size={14} aria-hidden="true" />
              Excluir funil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo funil</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Ex: Vendas, Suporte..."
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameDraft.trim()) createMutation.mutate(nameDraft.trim())
            }}
          />
          <DialogFooter>
            <Button
              onClick={() => createMutation.mutate(nameDraft.trim())}
              disabled={!nameDraft.trim() || createMutation.isPending}
            >
              Criar funil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear funil</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameDraft.trim()) renameMutation.mutate(nameDraft.trim())
            }}
          />
          <DialogFooter>
            <Button
              onClick={() => renameMutation.mutate(nameDraft.trim())}
              disabled={!nameDraft.trim() || renameMutation.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
