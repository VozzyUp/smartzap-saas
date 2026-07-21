'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MoveRight, MessageSquareText, PauseCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatRelativeTime } from '@/lib/date-utils'
import { listCardAutomationLog, setCardAutomationPaused, type CardAutomationLogEntry } from './api'
import type { KanbanCardWithContact } from './types'

const SOURCE_LABELS: Record<CardAutomationLogEntry['source'], string> = {
  ai: 'IA',
  keyword: 'palavra-chave',
  system: 'automático',
  manual: 'manual',
}

function describeEntry(entry: CardAutomationLogEntry): string {
  if (entry.eventType === 'followup_sent') {
    return `Follow-up enviado (${SOURCE_LABELS[entry.source]})`
  }
  const reason = (entry.detail as any)?.reason
  if (reason === 'followups_exhausted') return 'Movido: follow-ups esgotados sem resposta'
  return `Movido automaticamente (${SOURCE_LABELS[entry.source]})`
}

interface CardAutomationDialogProps {
  card: KanbanCardWithContact & { automation_paused?: boolean }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CardAutomationDialog({ card, open, onOpenChange }: CardAutomationDialogProps) {
  const queryClient = useQueryClient()
  const queryKey = ['kanban-card-automation-log', card.id] as const

  const { data: log = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listCardAutomationLog(card.id),
    enabled: open,
  })

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => setCardAutomationPaused(card.id, paused),
    onSuccess: (_data, paused) => {
      toast.success(paused ? 'Automação pausada neste card' : 'Automação retomada neste card')
      queryClient.invalidateQueries({ queryKey: ['kanban-board-data'] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar automação')
    },
  })

  const name = card.contact?.name?.trim() || card.contact?.phone || 'Contato'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>Histórico de automação e controle de pausa deste card.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-xl border border-[var(--ds-border-subtle)] p-3">
          <div className="flex items-center gap-2">
            <PauseCircle size={16} className="text-[var(--ds-text-muted)]" aria-hidden="true" />
            <Label htmlFor="automation-paused" className="text-sm">
              Pausar automação neste card
            </Label>
          </div>
          <Switch
            id="automation-paused"
            checked={card.automation_paused ?? false}
            onCheckedChange={(checked) => pauseMutation.mutate(checked)}
            disabled={pauseMutation.isPending}
          />
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-6 text-[var(--ds-text-muted)]">
              <Loader2 className="animate-spin" size={18} aria-hidden="true" />
            </div>
          )}

          {!isLoading && log.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--ds-text-muted)]">Nenhuma ação automática ainda</p>
          )}

          {log.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 rounded-lg bg-[var(--ds-bg-muted)] px-3 py-2">
              {entry.eventType === 'followup_sent' ? (
                <MessageSquareText size={14} className="mt-0.5 shrink-0 text-[var(--ds-text-muted)]" aria-hidden="true" />
              ) : (
                <MoveRight size={14} className="mt-0.5 shrink-0 text-[var(--ds-text-muted)]" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-sm text-[var(--ds-text-primary)]">{describeEntry(entry)}</p>
                <p className="text-xs text-[var(--ds-text-muted)]">{formatRelativeTime(entry.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
