'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const META_APP_ID_PATTERN = /^\d{5,20}$/

interface Props {
  onSave: (appId: string) => Promise<void>
  /** Texto de ajuda acima do campo. */
  hint?: React.ReactNode
  buttonLabel?: string
}

/** Campo + botão para informar o ID do Aplicativo da Meta (usado no criador de modelo). */
export function MetaAppIdInline({ onSave, hint, buttonLabel = 'Salvar e liberar mídia' }: Props) {
  const [draft, setDraft] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const valid = META_APP_ID_PATTERN.test(draft.trim())

  return (
    <div className="space-y-2">
      {hint ? <p className="text-xs text-amber-400/80">{hint}</p> : null}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="numeric"
          placeholder="ID do Aplicativo (só números)"
          aria-label="ID do Aplicativo da Meta"
          className="sm:max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave(draft.trim())
              setDraft('')
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Salvando…' : buttonLabel}
        </Button>
      </div>
    </div>
  )
}
