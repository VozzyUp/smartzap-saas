'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Clock3 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listFollowupRules, saveFollowupRules, type FollowupRule } from './api'

interface FollowupRulesEditorProps {
  stageId: string
  stageName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FollowupRulesEditor({ stageId, stageName, open, onOpenChange }: FollowupRulesEditorProps) {
  const queryClient = useQueryClient()
  const queryKey = ['kanban-followup-rules', stageId] as const
  const [rules, setRules] = useState<FollowupRule[]>([])

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFollowupRules(stageId),
    enabled: open,
  })

  useEffect(() => {
    if (data) setRules(data)
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () => saveFollowupRules(stageId, rules.map((r, i) => ({ ...r, position: i }))),
    onSuccess: () => {
      toast.success('Regras de follow-up salvas')
      queryClient.invalidateQueries({ queryKey })
      onOpenChange(false)
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar follow-up')
    },
  })

  const addRule = () => {
    setRules((prev) => [...prev, { dayOffset: 1, templateText: '', position: prev.length }])
  }

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index))
  }

  const updateRule = (index: number, patch: Partial<FollowupRule>) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const hasInvalidRule = rules.some((r) => !r.templateText.trim() || r.dayOffset < 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock3 size={16} aria-hidden="true" />
            Follow-up — {stageName}
          </DialogTitle>
          <DialogDescription>
            Se o cliente não responder, o sistema manda essas mensagens automaticamente, na ordem, em horário
            comercial.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-[var(--ds-text-muted)]">
            <Loader2 className="animate-spin" size={20} aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {rules.map((rule, index) => (
              <div key={index} className="space-y-2 rounded-xl border border-[var(--ds-border-subtle)] p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--ds-text-muted)]">Depois de</span>
                  <Input
                    type="number"
                    min={1}
                    value={rule.dayOffset}
                    onChange={(e) => updateRule(index, { dayOffset: Math.max(1, Number(e.target.value) || 1) })}
                    className="h-8 w-16"
                  />
                  <span className="text-xs text-[var(--ds-text-muted)]">dia(s) sem resposta</span>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    className="ml-auto rounded-md p-1 text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-muted)] hover:text-red-500"
                    aria-label="Remover regra"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
                <Textarea
                  placeholder="Oi {{nome}}, ainda tem interesse?"
                  value={rule.templateText}
                  onChange={(e) => updateRule(index, { templateText: e.target.value })}
                  rows={2}
                />
              </div>
            ))}

            {rules.length === 0 && (
              <p className="py-4 text-center text-sm text-[var(--ds-text-muted)]">
                Nenhum follow-up configurado para este estágio
              </p>
            )}

            <Button variant="outline" size="sm" onClick={addRule} className="w-full">
              <Plus size={14} className="mr-1.5" aria-hidden="true" />
              Adicionar follow-up
            </Button>

            <div className="flex justify-end pt-2">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || hasInvalidRule}>
                {saveMutation.isPending && <Loader2 className="mr-1.5 animate-spin" size={14} aria-hidden="true" />}
                Salvar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
