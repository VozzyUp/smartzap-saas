'use client'

import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { usePWA } from '@/components/pwa/PWAProvider'

const DISMISS_KEY = 'push-optin-dismissed-at'
const DISMISS_DAYS = 3

/**
 * Convite para ligar os avisos no aparelho. Sem ele ninguém se inscrevia: a função existia,
 * mas nenhum botão a chamava, então a transferência para humano não avisava ninguém.
 * Só aparece quando o aparelho aceita avisos (no iPhone, com o app instalado na tela inicial),
 * a permissão ainda não foi negada e este aparelho ainda não está inscrito.
 */
export function PushOptInCard() {
  const { pushPermission, isPushEnabled, enablePush } = usePWA()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  const eligible = pushPermission !== 'unsupported' && pushPermission !== 'denied' && !isPushEnabled

  useEffect(() => {
    if (!eligible) {
      setVisible(false)
      return
    }
    let dismissedAt = 0
    try {
      dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0)
    } catch {
      // sem armazenamento local: mostra mesmo assim
    }
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return
    // Espera o registro do aparelho carregar antes de concluir que não há inscrição.
    const timer = setTimeout(() => setVisible(true), 4000)
    return () => clearTimeout(timer)
  }, [eligible])

  if (!visible || !eligible) return null

  const dismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // ignora
    }
  }

  return (
    <div className="fixed left-4 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] md:left-auto md:w-96 z-50">
      <div className="rounded-xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center shrink-0">
            <BellRing className="w-5 h-5 text-primary-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--ds-text-primary)]">Receber avisos neste aparelho</h3>
            <p className="text-xs text-[var(--ds-text-secondary)] mt-0.5">
              Avisamos quando a IA passar uma conversa para você.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Agora não"
            className="inline-flex min-h-11 min-w-11 -m-2 items-center justify-center text-[var(--ds-text-muted)]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const ok = await enablePush()
            setBusy(false)
            if (ok) setVisible(false)
          }}
          className="mt-3 w-full min-h-11 rounded-lg bg-primary-600 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Ativando…' : 'Ativar avisos'}
        </button>
      </div>
    </div>
  )
}
