'use client'

import { useEffect, useMemo, useState } from 'react'
import { Wand2, Loader2 } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function CreateFlowWithAIDialog(props: {
  isCreating: boolean
  onCreate: (input: { name: string; prompt: string }) => Promise<any>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (!open) return
    // foco: não limpamos automaticamente para permitir iterar
  }, [open])

  const canSubmit = useMemo(() => {
    return name.trim().length >= 3 && prompt.trim().length >= 10 && !props.isCreating
  }, [name, prompt, props.isCreating])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" disabled={props.isCreating}>
          <Wand2 className="h-4 w-4" />
          Criar com IA
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xl bg-zinc-950 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>Criar MiniApp com IA</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Descreva o que você quer coletar. A IA sugere as perguntas e a gente já cria o MiniApp no modo “Formulário”.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="flow_ai_name">Nome</Label>
            <Input
              id="flow_ai_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: onboarding_lead"
            />
            <div className="text-[11px] text-gray-500">Dica: use snake_case e evite espaços.</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="flow_ai_prompt">O que você quer no formulário?</Label>
            <Textarea
              id="flow_ai_prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-28 bg-zinc-900 border-white/10 text-white"
              placeholder="Ex: Quero captar nome, telefone, e-mail, cidade, interesse (imóvel/financiamento), melhor horário para contato e um opt-in para receber novidades."
            />
            <div className="text-[11px] text-gray-500">Mínimo: 10 caracteres. Quanto mais contexto, melhor.</div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-white/10 bg-zinc-900 hover:bg-white/5"
            onClick={() => setOpen(false)}
            disabled={props.isCreating}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={async () => {
              const n = name.trim()
              const p = prompt.trim()
              if (!n || !p) return
              try {
                await props.onCreate({ name: n, prompt: p })
                setOpen(false)
                setName('')
                setPrompt('')
              } catch {
                // Errors handled by mutation toasts.
              }
            }}
            disabled={!canSubmit}
          >
            {props.isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando…
              </>
            ) : (
              'Criar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
