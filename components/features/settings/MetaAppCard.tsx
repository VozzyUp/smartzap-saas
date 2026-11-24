'use client'

import React, { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const APP_ID_PATTERN = /^\d{5,20}$/

/** Cartão "Aplicativo da Meta": ID do aplicativo, exigido para criar modelos com imagem/vídeo. */
export function MetaAppCard() {
  const [savedId, setSavedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/settings/meta-app')
        const data = res.ok ? await res.json() : null
        if (cancelled) return
        const id = data?.appId ? String(data.appId) : null
        setSavedId(id)
        setDraft(id ?? '')
      } catch {
        // sem rede: mostra como não salvo
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const valid = APP_ID_PATTERN.test(draft.trim())
  const dirty = draft.trim() !== (savedId ?? '')

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/meta-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: draft.trim() }),
      })
      if (!res.ok) throw new Error('Não foi possível salvar o ID do Aplicativo.')
      setSavedId(draft.trim())
      toast.success('ID do Aplicativo salvo.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-lg font-medium">Aplicativo da Meta</h3>
        {!loading && (
          <span
            className={`inline-flex items-center gap-1 text-xs ${savedId ? 'text-emerald-400' : 'text-amber-400'}`}
          >
            {savedId ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
            {savedId ? 'Salvo' : 'Não informado'}
          </span>
        )}
      </div>
      <p className="text-sm text-zinc-500 mb-4">
        O ID do Aplicativo fica no topo do painel do seu aplicativo em developers.facebook.com. Ele é necessário para
        criar modelos com imagem, vídeo ou documento no cabeçalho.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="metaAppId">ID do Aplicativo</Label>
          <Input
            id="metaAppId"
            inputMode="numeric"
            placeholder="Ex: 123456789012345"
            value={draft}
            disabled={loading}
            onChange={(e) => setDraft(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <Button type="button" onClick={handleSave} disabled={!valid || !dirty || saving || loading}>
          {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden="true" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  )
}
