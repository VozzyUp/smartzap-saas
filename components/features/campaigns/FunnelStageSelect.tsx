'use client'

import React, { useEffect, useState } from 'react'

export interface FunnelStageValue {
  boardId: string
  stageId: string
}

interface BoardOption {
  id: string
  name: string
  stages: Array<{ id: string; name: string }>
}

interface Props {
  value: FunnelStageValue | null
  onChange: (value: FunnelStageValue | null) => void
}

/** "Ao enviar, colocar o contato na fase": só aparece quando a conta tem quadro de funil. */
export function FunnelStageSelect({ value, onChange }: Props) {
  const [boards, setBoards] = useState<BoardOption[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/campaigns/funnel-options')
        const data = res.ok ? await res.json() : null
        if (!cancelled) setBoards(Array.isArray(data?.boards) ? data.boards : [])
      } catch {
        if (!cancelled) setBoards([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (boards.length === 0) return null

  const selectedBoard = boards.find((b) => b.id === value?.boardId) ?? null
  const selectClass =
    'h-10 rounded-lg border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] px-3 text-sm text-[var(--ds-text-primary)]'

  return (
    <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] p-4">
      <div className="text-sm font-semibold text-[var(--ds-text-primary)]">Ao enviar, colocar o contato na fase</div>
      <p className="mt-1 text-xs text-[var(--ds-text-muted)]">
        Opcional. Quem receber a mensagem ganha um cartão nesta fase do funil (quem já tem cartão no quadro não é movido).
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {boards.length > 1 && (
          <select
            aria-label="Quadro do funil"
            className={selectClass}
            value={selectedBoard?.id ?? ''}
            onChange={(e) => {
              const board = boards.find((b) => b.id === e.target.value)
              onChange(board ? { boardId: board.id, stageId: board.stages[0].id } : null)
            }}
          >
            <option value="">Não colocar no funil</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Fase do funil"
          className={selectClass}
          value={value?.boardId && boards.length === 1 ? value.stageId : value?.stageId ?? ''}
          onChange={(e) => {
            if (!e.target.value) return onChange(null)
            const board = selectedBoard ?? (boards.length === 1 ? boards[0] : null)
            if (!board) return
            onChange({ boardId: board.id, stageId: e.target.value })
          }}
        >
          <option value="">Não colocar no funil</option>
          {(selectedBoard ?? (boards.length === 1 ? boards[0] : null))?.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
