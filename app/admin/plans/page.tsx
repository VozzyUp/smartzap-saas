'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
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

async function patchPlan(id: string, body: Record<string, number | null>) {
  const res = await fetch(`/api/admin/plans/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'Erro ao atualizar plano')
  return data
}

function PlanCard({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [priceValue, setPriceValue] = useState('')

  useEffect(() => {
    setValues({
      max_contacts: plan.max_contacts === null ? '' : String(plan.max_contacts),
      max_templates: plan.max_templates === null ? '' : String(plan.max_templates),
      max_campaigns_per_month: plan.max_campaigns_per_month === null ? '' : String(plan.max_campaigns_per_month),
      max_whatsapp_numbers: plan.max_whatsapp_numbers === null ? '' : String(plan.max_whatsapp_numbers),
    })
    setPriceValue(plan.price_cents === null ? '' : (plan.price_cents / 100).toFixed(2).replace('.', ','))
  }, [plan])

  const mutation = useMutation({
    mutationFn: (body: Record<string, number | null>) => patchPlan(plan.id, body),
    onSuccess: () => {
      toast.success(`Plano "${plan.name}" atualizado.`)
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSave = () => {
    const body: Record<string, number | null> = {}
    for (const f of FIELDS) {
      const raw = values[f.key]?.trim() ?? ''
      body[f.key] = raw === '' ? null : Number(raw)
    }
    const rawPrice = priceValue.trim()
    body.price_cents = rawPrice === '' ? null : Math.round(parseFloat(rawPrice.replace(',', '.')) * 100)
    mutation.mutate(body)
  }

  return (
    <div className="rounded-xl border border-[var(--ds-border-subtle)] p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[var(--ds-text-primary)]">{plan.name}</h2>
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
      <Button onClick={handleSave} disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" />}
        Salvar
      </Button>
    </div>
  )
}

export default function AdminPlansPage() {
  const { data: plans, isLoading, isError } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: fetchPlans,
  })

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Planos</PageTitle>
          <PageDescription>Edite os limites de cada plano. Deixe em branco para ilimitado.</PageDescription>
        </div>
      </PageHeader>

      {isLoading && (
        <div className="flex items-center gap-2 text-[var(--ds-text-secondary)] text-sm">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Carregando planos...
        </div>
      )}

      {isError && <p className="text-sm text-[var(--ds-status-error-text)]">Erro ao carregar planos.</p>}

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
