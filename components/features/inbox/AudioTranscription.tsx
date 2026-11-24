import { cn } from '@/lib/utils'

/** Texto da transcrição gravada em `payload.transcription.text` (ou null). */
export function getAudioTranscription(payload: Record<string, unknown> | null | undefined): string | null {
  const t = (payload as { transcription?: { text?: unknown } } | null | undefined)?.transcription?.text
  return typeof t === 'string' && t.trim() ? t.trim() : null
}

/** Transcrição do áudio recebido, em texto menor, abaixo do player. Não renderiza nada sem transcrição. */
export function AudioTranscription({ payload, className }: { payload: Record<string, unknown> | null | undefined; className?: string }) {
  const text = getAudioTranscription(payload)
  if (!text) return null
  return (
    <div className={cn('mt-1.5 text-xs leading-snug text-[var(--ds-text-muted)]', className)} data-testid="audio-transcription">
      <span className="font-medium">Transcrição</span>
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
}
