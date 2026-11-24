'use client'

import React, { useRef, useState } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import type { Template } from '@/types'
import { TEMPLATE_HEADER_LIMITS, validateTemplateHeaderFile } from '@/lib/whatsapp/template-header-upload'

export type CampaignHeaderMediaFormat = 'IMAGE' | 'VIDEO'

/** Formato de mídia do cabeçalho (imagem/vídeo) do modelo, ou null. */
export function getTemplateHeaderMediaFormat(
  template: Pick<Template, 'components'> | null | undefined
): CampaignHeaderMediaFormat | null {
  const components = (template as any)?.components
  if (!Array.isArray(components)) return null
  const header = components.find((c: any) => String(c?.type || '').toUpperCase() === 'HEADER')
  const format = String(header?.format || '').toUpperCase()
  return format === 'IMAGE' || format === 'VIDEO' ? format : null
}

interface Props {
  format: CampaignHeaderMediaFormat
  /** media id já enviado (headerMediaId) */
  value: string | null
  fileName: string | null
  onChange: (mediaId: string | null, fileName: string | null) => void
}

/** Campo opcional "Enviar com este arquivo": sobe a mídia para o número e devolve o media id. */
export function HeaderMediaUploadField({ format, value, fileName, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const limits = TEMPLATE_HEADER_LIMITS[format]

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const check = validateTemplateHeaderFile({ format, fileName: file.name, size: file.size, mimeType: file.type })
    if (!check.ok) {
      setError(check.error)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('format', format)
      const res = await fetch('/api/campaigns/header-media', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.mediaId) throw new Error(data?.error || 'Falha ao enviar o arquivo.')
      onChange(String(data.mediaId), String(data.fileName || file.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-elevated)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--ds-text-primary)]">Enviar com este arquivo</div>
          <p className="mt-1 text-xs text-[var(--ds-text-muted)]">
            Opcional. Sem arquivo, usamos a {limits.label} de exemplo do modelo. {limits.hint}
          </p>
        </div>
        {value ? (
          <div className="flex items-center gap-2 text-sm text-[var(--ds-text-primary)]">
            <Paperclip size={14} />
            <span className="max-w-[220px] truncate">{fileName || 'arquivo enviado'}</span>
            <button
              type="button"
              onClick={() => onChange(null, null)}
              className="inline-flex items-center gap-1 text-xs text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)]"
            >
              <X size={12} />
              Remover
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--ds-border-default)] bg-[var(--ds-bg-surface)] px-3 py-2 text-sm font-medium text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)] disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
            {uploading ? 'Enviando...' : `Escolher ${limits.label}`}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={limits.accept}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
