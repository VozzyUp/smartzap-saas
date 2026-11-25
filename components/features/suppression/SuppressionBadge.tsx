'use client'

import React, { useState } from 'react'
import { Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { suppressionBadgeLabel } from '@/lib/suppression-badge'

export interface SuppressionBadgeProps {
  source?: string | null
  /** Libera o número. Sem isto, o botão "Liberar" não aparece. */
  onRelease?: () => void | Promise<void>
  isReleasing?: boolean
  /** Em telas estreitas (< 640 px) mostra só "Bloqueado". */
  shortOnNarrow?: boolean
  className?: string
}

/** Selo "Bloqueado" + ação "Liberar" (com confirmação). */
export function SuppressionBadge({
  source,
  onRelease,
  isReleasing,
  shortOnNarrow,
  className,
}: SuppressionBadgeProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const label = suppressionBadgeLabel(source)

  return (
    <span className={cn('inline-flex items-center gap-1 min-w-0', className)}>
      <span
        title={label}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-[var(--ds-status-error-text)]"
      >
        <Ban size={14} className="shrink-0" aria-hidden="true" />
        {shortOnNarrow ? (
          <>
            <span className="sm:hidden">Bloqueado</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      {onRelease && (
        <>
          <button
            type="button"
            aria-label="Liberar número bloqueado"
            disabled={isReleasing}
            onClick={(e) => {
              e.stopPropagation()
              setConfirmOpen(true)
            }}
            className="-my-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-medium text-[var(--ds-text-secondary)] underline underline-offset-2 hover:text-[var(--ds-text-primary)] disabled:opacity-50"
          >
            Liberar
          </button>
          <ConfirmationDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Liberar número"
            description="Liberar este número? A IA volta a responder e ele volta a receber campanhas."
            confirmLabel="Liberar"
            isLoading={isReleasing}
            onConfirm={async () => {
              await onRelease()
              setConfirmOpen(false)
            }}
          />
        </>
      )}
    </span>
  )
}
