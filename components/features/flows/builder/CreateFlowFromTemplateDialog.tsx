'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, LayoutTemplate, Loader2 } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFlowTemplates } from '@/hooks/useFlowTemplates'

export function CreateFlowFromTemplateDialog(props: {
  isCreating: boolean
  onCreate: (input: { name: string; templateKey: string }) => Promise<any>
}) {
  const templatesQuery = useFlowTemplates()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [templateKey, setTemplateKey] = useState<string>('')

  const templates = templatesQuery.data || []

  useEffect(() => {
    if (!open) return
    if (!templateKey && templates.length > 0) setTemplateKey(templates[0].key)
  }, [open, templates.length])

  const canSubmit = useMemo(() => {
    return name.trim().length >= 3 && !!templateKey && !props.isCreating
  }, [name, templateKey, props.isCreating])

  const selected = templates.find((t) => t.key === templateKey) || null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          <LayoutTemplate className="h-4 w-4" />
          Criar por template
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Criar MiniApp por template</DialogTitle>
          <DialogDescription>
            Comece a partir de um modelo pronto (Lead/Cadastro, Agendamento, NPS).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="flow_name">Nome</Label>
            <Input id="flow_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: lead_cadastro_jan2026" />
            <div className="text-[11px] text-gray-500">Dica: nomes curtos e consistentes (ex.: snake_case).</div>
          </div>

          <div className="space-y-2">
            <Label>Template</Label>

            {templatesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando templates…
              </div>
            ) : templates.length === 0 ? (
              <div className="text-sm text-gray-400">Nenhum template disponível.</div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTemplateKey(t.key)}
                    className={
                      'text-left rounded-lg border px-3 py-2 transition ' +
                      (templateKey === t.key
                        ? 'border-primary-500 bg-white/5'
                        : 'border-white/10 bg-zinc-900 hover:bg-white/5')
                    }
                  >
                    <div className="text-sm text-gray-200 font-medium">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.description}</div>
                    <div className="text-[11px] text-gray-600 mt-1 font-mono">{t.key}</div>
                  </button>
                ))}
              </div>
            )}

            {selected ? (
              <div className="text-xs text-gray-500">
                {selected.isDynamic ? 'Modelo dinâmico: atualiza dados em tempo real.' : 'Modelo simples: pronto para usar.'}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-white/10 bg-zinc-900 hover:bg-white/5"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={async () => {
              const n = name.trim()
              if (!n || !templateKey) return
              try {
                await props.onCreate({ name: n, templateKey })
                setName('')
                setOpen(false)
              } catch {
                // Errors handled by mutation toasts.
              }
            }}
            disabled={!canSubmit}
          >
            <Plus className="h-4 w-4" />
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
