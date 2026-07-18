'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createStage } from './api'
import { STAGE_COLORS } from './types'

export function NewStageColumn({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient()
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')

  const mutation = useMutation({
    mutationFn: (stageName: string) => {
      const color = STAGE_COLORS[Math.floor(Math.random() * STAGE_COLORS.length)]
      return createStage(boardId, { name: stageName, color })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-board-data', boardId] })
      setName('')
      setIsAdding(false)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar fase')
    },
  })

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setIsAdding(false)
      return
    }
    mutation.mutate(trimmed)
  }

  if (isAdding) {
    return (
      <div className="flex h-fit w-72 shrink-0 flex-col gap-2 rounded-2xl border border-[var(--ds-border-subtle)] bg-[var(--ds-bg-surface)] p-3">
        <Input
          autoFocus
          placeholder="Nome da fase"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') {
              setIsAdding(false)
              setName('')
            }
          }}
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSubmit} disabled={mutation.isPending}>
            Adicionar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAdding(false)
              setName('')
            }}
          >
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setIsAdding(true)}
      className="flex h-14 w-72 shrink-0 items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ds-border-subtle)] text-sm font-medium text-[var(--ds-text-muted)] hover:border-[var(--ds-border-default)] hover:text-[var(--ds-text-primary)] transition-colors"
    >
      <Plus size={16} aria-hidden="true" />
      Nova fase
    </button>
  )
}
