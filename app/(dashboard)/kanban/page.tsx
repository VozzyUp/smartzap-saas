'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KanbanSquare, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Page, PageHeader, PageTitle, PageDescription } from '@/components/ui/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BoardSelector, KanbanBoardView, listBoards, createBoard, type KanbanBoard } from '@/components/features/kanban'

const LAST_BOARD_STORAGE_KEY = 'kanban-last-board-id'

function EmptyState({ onCreate, isCreating }: { onCreate: (name: string) => void; isCreating: boolean }) {
  const [name, setName] = useState('')

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-[var(--ds-border-subtle)] bg-[var(--ds-bg-surface)] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/10">
          <KanbanSquare className="h-6 w-6 text-primary-400" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-medium text-[var(--ds-text-primary)]">Nenhum funil criado</h3>
        <p className="mt-1 mb-5 text-sm text-[var(--ds-text-muted)]">
          Crie um funil para organizar seus clientes por fase (ex: Novo, Em andamento, Concluído).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Nome do funil (ex: Vendas)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onCreate(name.trim())
            }}
          />
          <Button onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim() || isCreating}>
            {isCreating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            Criar meu primeiro funil
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function KanbanPage() {
  const queryClient = useQueryClient()
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)

  const { data: boards = [], isLoading } = useQuery<KanbanBoard[]>({
    queryKey: ['kanban-boards'],
    queryFn: listBoards,
  })

  // Restaura a última seleção do usuário (best-effort, cliente apenas).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(LAST_BOARD_STORAGE_KEY)
    if (stored) setSelectedBoardId(stored)
  }, [])

  // Garante que sempre há um board selecionado válido quando a lista carrega.
  useEffect(() => {
    if (boards.length === 0) return
    if (selectedBoardId && boards.some((b) => b.id === selectedBoardId)) return
    setSelectedBoardId(boards[0].id)
  }, [boards, selectedBoardId])

  const handleSelect = (boardId: string) => {
    setSelectedBoardId(boardId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_BOARD_STORAGE_KEY, boardId)
    }
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => createBoard(name),
    onSuccess: (board) => {
      toast.success('Funil criado')
      queryClient.invalidateQueries({ queryKey: ['kanban-boards'] })
      handleSelect(board.id)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar funil')
    },
  })

  const selectedBoard = useMemo(
    () => boards.find((b) => b.id === selectedBoardId) ?? null,
    [boards, selectedBoardId]
  )

  if (isLoading) {
    return (
      <Page className="flex h-full flex-col space-y-4">
        <div className="flex flex-1 items-center justify-center text-[var(--ds-text-muted)]">
          <Loader2 className="animate-spin" size={24} aria-hidden="true" />
        </div>
      </Page>
    )
  }

  return (
    <Page className="flex h-full flex-col space-y-4">
      <PageHeader>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/10">
            <KanbanSquare className="h-6 w-6 text-primary-400" aria-hidden="true" />
          </div>
          <div>
            <PageTitle>Funil</PageTitle>
            <PageDescription>Organize seus clientes por fase e acompanhe o progresso</PageDescription>
          </div>
        </div>

        {boards.length > 0 && (
          <BoardSelector
            boards={boards}
            selectedBoard={selectedBoard}
            onSelect={handleSelect}
            onCreated={handleSelect}
            onDeleted={() => setSelectedBoardId(null)}
          />
        )}
      </PageHeader>

      {boards.length === 0 ? (
        <EmptyState onCreate={(name) => createMutation.mutate(name)} isCreating={createMutation.isPending} />
      ) : selectedBoard ? (
        <KanbanBoardView boardId={selectedBoard.id} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[var(--ds-text-muted)]">
          <Loader2 className="animate-spin" size={24} aria-hidden="true" />
        </div>
      )}
    </Page>
  )
}
