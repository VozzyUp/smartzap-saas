'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Page, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type TenantDetail = {
  id: string
  name: string
  slug: string
  status: string
  trial_ends_at: string | null
  suspended_at: string | null
  plan_id: string | null
}

type TenantUser = {
  user_id: string
  email: string
  role: string
  created_at: string
}

type Plan = {
  id: string
  slug: string
  name: string
}

async function fetchTenantDetail(id: string): Promise<{ tenant: TenantDetail; users: TenantUser[] }> {
  const res = await fetch(`/api/admin/tenants/${id}`)
  if (!res.ok) throw new Error('Erro ao buscar tenant')
  return res.json()
}

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch('/api/admin/plans')
  if (!res.ok) throw new Error('Erro ao buscar planos')
  const data = await res.json()
  return data.plans ?? []
}

async function patchTenant(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/tenants/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'Erro ao atualizar tenant')
  return data
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'trialing') return 'warning'
  if (status === 'suspended') return 'error'
  return 'default'
}

function statusLabel(status: string): string {
  if (status === 'active') return 'Ativo'
  if (status === 'trialing') return 'Trial'
  if (status === 'suspended') return 'Suspenso'
  return status
}

export default function AdminTenantDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'tenants', id],
    queryFn: () => fetchTenantDetail(id),
    enabled: !!id,
  })

  const { data: plans } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: fetchPlans,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] })
  }

  const changePlanMutation = useMutation({
    mutationFn: (planSlug: string) => patchTenant(id, { planSlug }),
    onSuccess: () => {
      toast.success('Plano atualizado.')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleStatusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') => patchTenant(id, { status }),
    onSuccess: (_data, status) => {
      toast.success(status === 'suspended' ? 'Tenant suspenso.' : 'Tenant reativado.')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--ds-text-secondary)] text-sm">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Carregando...
      </div>
    )
  }

  if (isError || !data) {
    return <p className="text-sm text-[var(--ds-status-error-text)]">Erro ao carregar tenant.</p>
  }

  const { tenant, users } = data
  const currentPlanSlug = plans?.find((p) => p.id === tenant.plan_id)?.slug

  return (
    <Page>
      <PageHeader>
        <div>
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-1 text-sm text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] transition-colors mb-2"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Voltar
          </button>
          <PageTitle>{tenant.name}</PageTitle>
          <PageDescription>{tenant.slug}</PageDescription>
        </div>
        <Badge variant={statusVariant(tenant.status)}>{statusLabel(tenant.status)}</Badge>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--ds-border-subtle)] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--ds-text-primary)]">Plano</h2>
          <Select
            value={currentPlanSlug}
            onValueChange={(planSlug) => changePlanMutation.mutate(planSlug)}
            disabled={changePlanMutation.isPending || !plans}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione o plano" />
            </SelectTrigger>
            <SelectContent>
              {(plans ?? []).map((plan) => (
                <SelectItem key={plan.id} value={plan.slug}>
                  {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tenant.trial_ends_at && (
            <p className="text-xs text-[var(--ds-text-muted)]">
              Trial até {new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--ds-border-subtle)] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--ds-text-primary)]">Conta</h2>
          <p className="text-sm text-[var(--ds-text-secondary)]">
            {tenant.status === 'suspended'
              ? `Suspenso em ${tenant.suspended_at ? new Date(tenant.suspended_at).toLocaleDateString('pt-BR') : '—'}`
              : 'Conta ativa.'}
          </p>
          <Button
            variant={tenant.status === 'suspended' ? 'default' : 'destructive'}
            onClick={() =>
              toggleStatusMutation.mutate(tenant.status === 'suspended' ? 'active' : 'suspended')
            }
            disabled={toggleStatusMutation.isPending}
          >
            {toggleStatusMutation.isPending && <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" />}
            {tenant.status === 'suspended' ? 'Reativar' : 'Suspender'}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--ds-text-primary)]">Usuários</h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--ds-border-subtle)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ds-bg-surface)] text-[var(--ds-text-secondary)]">
              <tr>
                <th className="text-left font-medium px-4 py-3">E-mail</th>
                <th className="text-left font-medium px-4 py-3">Papel</th>
                <th className="text-left font-medium px-4 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-[var(--ds-border-subtle)]">
                  <td className="px-4 py-3 text-[var(--ds-text-primary)]">{u.email}</td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">{u.role}</td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">
                    {new Date(u.created_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-[var(--ds-text-muted)]">
                    Nenhum usuário.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  )
}
