'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getBoardAutomationConfig,
  saveBoardAutomationConfig,
  listQuoteKeywords,
  addQuoteKeyword,
  removeQuoteKeyword,
  type AutomationEventType,
  type BoardAutomationConfig,
} from './api'
import type { KanbanStageWithCards } from './types'

const EVENT_LABELS: Record<AutomationEventType, string> = {
  message_sent: 'Mensagem enviada',
  client_replied: 'Cliente respondeu',
  quote_detected: 'Cliente pediu orçamento',
}

const EVENT_TYPES: AutomationEventType[] = ['message_sent', 'client_replied', 'quote_detected']

const NONE_VALUE = '__none__'

interface AutomationPanelProps {
  boardId: string
  stages: KanbanStageWithCards[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AutomationPanel({ boardId, stages, open, onOpenChange }: AutomationPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap size={16} aria-hidden="true" />
            Automação do funil
          </DialogTitle>
          <DialogDescription>
            Configure quando os cards devem se mover sozinhos, seguindo a conversa no WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events">Eventos</TabsTrigger>
            <TabsTrigger value="keywords">Palavras-chave</TabsTrigger>
          </TabsList>
          <TabsContent value="events">
            <EventsTab boardId={boardId} stages={stages} open={open} />
          </TabsContent>
          <TabsContent value="keywords">
            <KeywordsTab open={open} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function EventsTab({ boardId, stages, open }: { boardId: string; stages: KanbanStageWithCards[]; open: boolean }) {
  const queryClient = useQueryClient()
  const queryKey = ['kanban-board-automation', boardId] as const

  const { data, isLoading } = useQuery<BoardAutomationConfig>({
    queryKey,
    queryFn: () => getBoardAutomationConfig(boardId),
    enabled: open,
  })

  const [mapping, setMapping] = useState<Partial<Record<AutomationEventType, string>>>({})
  const [windowStart, setWindowStart] = useState('09:00')
  const [windowEnd, setWindowEnd] = useState('18:00')
  const [staleStageId, setStaleStageId] = useState<string>(NONE_VALUE)

  useEffect(() => {
    if (!data) return
    const next: Partial<Record<AutomationEventType, string>> = {}
    for (const eventType of EVENT_TYPES) {
      const entry = data.automations[eventType]
      if (entry?.active) next[eventType] = entry.targetStageId
    }
    setMapping(next)
    setWindowStart(data.settings?.windowStart?.slice(0, 5) ?? '09:00')
    setWindowEnd(data.settings?.windowEnd?.slice(0, 5) ?? '18:00')
    setStaleStageId(data.settings?.staleStageId ?? NONE_VALUE)
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () =>
      saveBoardAutomationConfig(boardId, {
        automations: Object.fromEntries(
          EVENT_TYPES.map((eventType) => [
            eventType,
            mapping[eventType] ? { targetStageId: mapping[eventType]!, active: true } : null,
          ])
        ),
        settings: {
          windowStart: `${windowStart}:00`,
          windowEnd: `${windowEnd}:00`,
          weekdaysMask: 62, // seg-sex — sem UI de dia da semana ainda, fica fixo por ora
          staleStageId: staleStageId === NONE_VALUE ? null : staleStageId,
        },
      }),
    onSuccess: () => {
      toast.success('Automação salva')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar automação')
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--ds-text-muted)]">
        <Loader2 className="animate-spin" size={20} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-xs text-[var(--ds-text-muted)]">
        A automação nunca move um card para uma coluna anterior — só avança. Deixe "Não mover" para manter esse
        evento 100% manual.
      </p>

      {EVENT_TYPES.map((eventType) => (
        <div key={eventType} className="space-y-1.5">
          <Label className="text-xs">{EVENT_LABELS[eventType]}</Label>
          <Select
            value={mapping[eventType] ?? NONE_VALUE}
            onValueChange={(value) =>
              setMapping((prev) => ({ ...prev, [eventType]: value === NONE_VALUE ? undefined : value }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Não mover" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Não mover (manual)</SelectItem>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3 pt-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Follow-up a partir de</Label>
          <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Até</Label>
          <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Se os follow-ups acabarem sem resposta, mover para</Label>
        <Select value={staleStageId} onValueChange={setStaleStageId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Não mover" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Não mover</SelectItem>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="mr-1.5 animate-spin" size={14} aria-hidden="true" />}
          Salvar
        </Button>
      </div>
    </div>
  )
}

function KeywordsTab({ open }: { open: boolean }) {
  const queryClient = useQueryClient()
  const queryKey = ['kanban-quote-keywords'] as const
  const [newKeyword, setNewKeyword] = useState('')

  const { data: keywords = [], isLoading } = useQuery({
    queryKey,
    queryFn: listQuoteKeywords,
    enabled: open,
  })

  const addMutation = useMutation({
    mutationFn: (keyword: string) => addQuoteKeyword(keyword),
    onSuccess: () => {
      setNewKeyword('')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Erro ao adicionar palavra-chave')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (keywordId: string) => removeQuoteKeyword(keywordId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const handleAdd = () => {
    const trimmed = newKeyword.trim()
    if (!trimmed) return
    addMutation.mutate(trimmed)
  }

  return (
    <div className="space-y-3 py-2">
      <p className="text-xs text-[var(--ds-text-muted)]">
        Quando o cliente mandar uma mensagem com uma dessas palavras, o card é movido mesmo em conversas sem o
        agente de IA ativo.
      </p>

      <div className="flex gap-2">
        <Input
          placeholder="ex: orçamento, quanto custa..."
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button size="icon" onClick={handleAdd} disabled={addMutation.isPending || !newKeyword.trim()}>
          <Plus size={16} aria-hidden="true" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-[var(--ds-text-muted)]">
          <Loader2 className="animate-spin" size={18} aria-hidden="true" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {keywords.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--ds-text-muted)] w-full">Nenhuma palavra-chave configurada</p>
          )}
          {keywords.map((k) => (
            <span
              key={k.id}
              className="flex items-center gap-1 rounded-full bg-[var(--ds-bg-muted)] px-2.5 py-1 text-xs text-[var(--ds-text-primary)]"
            >
              {k.keyword}
              <button
                type="button"
                onClick={() => removeMutation.mutate(k.id)}
                className="text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)]"
                aria-label={`Remover ${k.keyword}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
