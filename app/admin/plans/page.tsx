'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Page, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

type Plan = {
  id: string
  slug: string
  name: string
  max_contacts: number | null
  max_templates: number | null
  max_campaigns_per_month: number | null
  max_whatsapp_numbers: number | null
  price_cents: number | null
}

const FIELDS: { key: keyof Plan; label: string }[] = [
  { key: 'max_contacts', label: 'Máx. contatos' },
  { key: 'max_templates', label: 'Máx. templates' },
  { key: 'max_campaigns_per_month', label: 'Máx. campanhas/mês' },
  { key: 'max_whatsapp_numbers', label: 'Máx. números WhatsApp' },
]

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch('/api/admin/plans')
  if (!res.ok) throw new Error('Erro ao buscar planos')
  const data = await res.json()
  return data.plans ?? []
}

type PlanUpdate = Record<string, number | string | null>

async function patchPlan(id: string, body: PlanUpdate) {
  const res = await fetch(`/api/admin/plans/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'Erro ao atualizar plano')
  return data
}

async function createPlan(name: string) {
  const res = await fetch('/api/admin/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error === 'name_already_exists' ? 'JÃ¡ existe um plano com esse nome.' : data?.error || 'Erro ao criar plano')
  return data
}

async function deletePlan(id: string) {
  const res = await fetch(`/api/admin/plans/${id}`, { method: 'DELETE' })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (data?.error === 'plan_in_use') throw new Error(`Este plano estÃ¡ vinculado a ${data.tenants} tenant(s). Mova-os para outro plano antes de excluÃ­-lo.`)
    throw new Error(data?.error || 'Erro ao excluir plano')
  }
}

function PlanCard({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [priceValue, setPriceValue] = useState('')
  const [name, setName] = useState(plan.name)

  useEffect(() => {
    setName(plan.name)
    setValues({
      max_contacts: plan.max_contacts === null ? '' : String(plan.max_contacts),
      max_templates: plan.max_templates === null ? '' : String(plan.max_templates),
      max_campaigns_per_month: plan.max_campaigns_per_month === null ? '' : String(plan.max_campaigns_per_month),
      max_whatsapp_numbers: plan.max_whatsapp_numbers === null ? '' : String(plan.max_whatsapp_numbers),
    })
    setPriceValue(plan.price_cents === null ? '' : (plan.price_cents / 100).toFixed(2).replace('.', ','))
  }, [plan])

  const mutation = useMutation({
    mutationFn: (body: PlanUpdate) => patchPlan(plan.id, body),
    onSuccess: () => {
      toast.success(`Plano "${plan.name}" atualizado.`)
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deletePlan(plan.id),
    onSuccess: () => {
      toast.success(`Plano "${plan.name}" excluÃ­do.`)
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSave = () => {
    const body: PlanUpdate = { name: name.trim() }
    for (const f of FIELDS) {
      const raw = values[f.key]?.trim() ?? ''
      body[f.key] = raw === '' ? null : Number(raw)
    }
    const rawPrice = priceValue.trim()
    body.price_cents = rawPrice === '' ? null : Math.round(parseFloat(rawPrice.replace(',', '.')) * 100)
    mutation.mutate(body)
  }

  const handleDelete = () => {
    if (window.confirm(`Excluir o plano "${plan.name}"? Esta aÃ§Ã£o nÃ£o pode ser desfeita.`)) deleteMutation.mutate()
  }

  return (
    <div className="rounded-xl border border-[var(--ds-border-subtle)] p-5 space-y-4">
      <div className="space-y-1">
        <Label htmlFor={`${plan.id}-name`}>Nome do plano</Label>
        <Input
          id={`${plan.id}-name`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`${plan.id}-${f.key}`}>{f.label}</Label>
            <Input
              id={`${plan.id}-${f.key}`}
              type="number"
              min={0}
              placeholder="Ilimitado"
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor={`${plan.id}-price_cents`}>Preço mensal (R$)</Label>
          <Input
            id={`${plan.id}-price_cents`}
            type="text"
            inputMode="decimal"
            placeholder="Grátis"
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button onClick={handleSave} disabled={mutation.isPending || deleteMutation.isPending}>
          {mutation.isPending && <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" />}
          Salvar
        </Button>
        <Button variant="ghost-destructive" onClick={handleDelete} disabled={mutation.isPending || deleteMutation.isPending}>
          {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" /> : <Trash2 size={14} className="mr-2" aria-hidden="true" />}
          Excluir
        </Button>
      </div>
    </div>
  )
}

function CreatePlanForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const mutation = useMutation({
    mutationFn: () => createPlan(name.trim()),
    onSuccess: () => {
      toast.success('Plano criado. Defina os limites e salve.')
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <form
      className="rounded-xl border border-[var(--ds-border-subtle)] p-5 flex flex-col sm:flex-row gap-3 sm:items-end"
      onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}
    >
      <div className="space-y-1 flex-1">
        <Label htmlFor="new-plan-name">Nome do novo plano</Label>
        <Input id="new-plan-name" value={name} maxLength={80} placeholder="Ex.: Empresarial" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending || name.trim().length < 2}>
          {mutation.isPending && <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" />}
          Criar plano
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
      </div>
    </form>
  )
}

export default function AdminPlansPage() {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const { data: plans, isLoading, isError } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: fetchPlans,
  })

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Planos</PageTitle>
          <PageDescription>Crie, renomeie e edite os limites de cada plano. Deixe em branco para ilimitado.</PageDescription>
        </div>
        <Button size="sm" onClick={() => setShowCreateForm((visible) => !visible)}>
          <Plus size={14} className="mr-1.5" aria-hidden="true" />
          Novo plano
        </Button>
      </PageHeader>

      {isLoading && (
        <div className="flex items-center gap-2 text-[var(--ds-text-secondary)] text-sm">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Carregando planos...
        </div>
      )}

      {isError && <p className="text-sm text-[var(--ds-status-error-text)]">Erro ao carregar planos.</p>}

      {showCreateForm && <div className="mb-4"><CreatePlanForm onClose={() => setShowCreateForm(false)} /></div>}

      {!isLoading && !isError && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(plans ?? []).map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </Page>
  )
}
