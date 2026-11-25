'use client'

import React from 'react'
import { usePhoneSuppression } from '@/hooks/usePhoneSuppression'
import { suppressionInboxNotice } from '@/lib/suppression-badge'

/** Faixa de uma linha acima do campo de mensagem quando a IA está silenciada por opt-out. */
export function SuppressionNotice({ phone }: { phone: string | null | undefined }) {
  const { suppression } = usePhoneSuppression(phone)
  if (!suppression) return null
  const text = suppressionInboxNotice(suppression.source)
  if (!text) return null
  return (
    <div
      role="status"
      className="px-3 py-1.5 border-t border-[var(--ds-border-subtle)] bg-red-500/10 text-xs text-[var(--ds-status-error-text)] truncate"
      title={text}
    >
      {text}
    </div>
  )
}
