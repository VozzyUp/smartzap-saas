'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Phone, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/date-utils'
import type { KanbanCardWithContact } from './types'

interface ContactCardProps {
  card: KanbanCardWithContact
  /** Renderização estática usada no DragOverlay (sem listeners de dnd-kit). */
  overlay?: boolean
}

export function ContactCard({ card, overlay }: ContactCardProps) {
  const sortable = useSortable({
    id: card.id,
    data: { type: 'card', card },
    disabled: overlay,
  })

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable

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
      className={cn(
        'group rounded-2xl border border-[var(--ds-border-subtle)] bg-[var(--ds-bg-elevated)] p-3 shadow-sm',
        'hover:border-[var(--ds-border-default)] hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing',
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
          <p className="mt-1.5 text-[11px] text-[var(--ds-text-muted)]">
            {formatRelativeTime(card.moved_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
