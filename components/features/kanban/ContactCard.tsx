'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Phone, GripVertical, History, PauseCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/date-utils'
import { CardAutomationDialog } from './CardAutomationDialog'
import type { KanbanCardWithContact } from './types'

interface ContactCardProps {
  card: KanbanCardWithContact
  /** Renderização estática usada no DragOverlay (sem listeners de dnd-kit). */
  overlay?: boolean
}

export function ContactCard({ card, overlay }: ContactCardProps) {
  const router = useRouter()
  const [isAutomationOpen, setIsAutomationOpen] = useState(false)
  const draggedRef = useRef(false)
  const sortable = useSortable({
    id: card.id,
    data: { type: 'card', card },
    disabled: overlay,
  })

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable

  // Um arrasto nunca pode terminar em navegação: marca enquanto arrasta e solta logo depois.
  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true
      return
    }
    const t = setTimeout(() => {
      draggedRef.current = false
    }, 150)
    return () => clearTimeout(t)
  }, [isDragging])

  const openConversation = () => {
    if (draggedRef.current) return
    if (!card.conversation_id) {
      toast.info('Este contato ainda não tem conversa.')
      return
    }
    router.push(`/inbox/${card.conversation_id}`)
  }

  const style = overlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      }

  const name = card.contact?.name?.trim() || card.contact?.phone || 'Contato'
  const phone = card.contact?.phone

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      {...(overlay
        ? {}
        : {
            'aria-label': `Abrir conversa de ${card.contact?.name?.trim() || card.contact?.phone || 'contato'}`,
            onClick: (e: MouseEvent<HTMLDivElement>) => {
              // Cliques vindos do diálogo (portal) ou de controles internos não abrem a conversa.
              if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button,a,input')) return
              if (!e.currentTarget.contains(e.target as Node)) return
              openConversation()
            },
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              ;(listeners as any)?.onKeyDown?.(e)
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openConversation()
              }
            },
          })}
      className={cn(
        'group rounded-2xl border border-[var(--ds-border-subtle)] bg-[var(--ds-bg-elevated)] p-3 shadow-sm',
        'hover:border-[var(--ds-border-default)] hover:shadow-md transition-shadow cursor-pointer active:cursor-grabbing',
        isDragging && !overlay && 'opacity-40',
        overlay && 'shadow-lg rotate-2 cursor-grabbing'
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical
          size={14}
          className="mt-0.5 shrink-0 text-[var(--ds-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--ds-text-primary)]">{name}</p>
          {phone && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--ds-text-muted)]">
              <Phone size={10} aria-hidden="true" />
              {phone}
            </p>
          )}
          <div className="mt-1.5 flex items-center justify-between">
            <p className="text-[11px] text-[var(--ds-text-muted)]">{formatRelativeTime(card.moved_at)}</p>
            {!overlay && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setIsAutomationOpen(true)
                }}
                className="inline-flex max-sm:min-h-11 max-sm:min-w-11 items-center justify-center rounded-md p-1 text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-muted)] hover:text-[var(--ds-text-primary)] sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="Ver histórico de automação"
              >
                {card.automation_paused ? (
                  <PauseCircle size={12} aria-hidden="true" />
                ) : (
                  <History size={12} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {!overlay && (
        <CardAutomationDialog card={card} open={isAutomationOpen} onOpenChange={setIsAutomationOpen} />
      )}
    </div>
  )
}
