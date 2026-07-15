'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2 } from 'lucide-react'
import { Page, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

type AdminTenant = {
  id: string
  name: string
  slug: string
  status: string
  trial_ends_at: string | null
  suspended_at: string | null
  plan_slug: string | null
  plan_name: string | null
  max_contacts: number | null
  max_templates: number | null
  max_campaigns_per_month: number | null
  max_whatsapp_numbers: number | null
  used_contacts: number
  used_templates: number
  used_campaigns_month: number
  used_whatsapp_numbers: number
}

async function fetchTenants(): Promise<AdminTenant[]> {
  const res = await fetch('/api/admin/tenants')
  if (!res.ok) throw new Error('Erro ao buscar tenants')
  const data = await res.json()
  return data.tenants ?? []
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

function usageCell(used: number, max: number | null) {
  return (
    <span className="tabular-nums">
      {used} / {max === null ? '∞' : max}
    </span>
  )
}

export default function AdminTenantsPage() {
  const [search, setSearch] = useState('')

  const { data: tenants, isLoading, isError } = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: fetchTenants,
  })

  const filtered = useMemo(() => {
    if (!tenants) return []
    const q = search.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter((t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
  }, [tenants, search])

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Tenants</PageTitle>
          <PageDescription>Lista de clientes, plano e uso vs limite.</PageDescription>
        </div>
      </PageHeader>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)]" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou slug..."
          className="pl-9"
        />
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-[var(--ds-text-secondary)] text-sm">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Carregando tenants...
        </div>
      )}

      {isError && (
        <p className="text-sm text-[var(--ds-status-error-text)]">Erro ao carregar tenants.</p>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-[var(--ds-border-subtle)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ds-bg-surface)] text-[var(--ds-text-secondary)]">
              <tr>
                <th className="text-left font-medium px-4 py-3">Nome</th>
                <th className="text-left font-medium px-4 py-3">Plano</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Trial até</th>
                <th className="text-left font-medium px-4 py-3">Contatos</th>
                <th className="text-left font-medium px-4 py-3">Templates</th>
                <th className="text-left font-medium px-4 py-3">Campanhas/mês</th>
                <th className="text-left font-medium px-4 py-3">Nº WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-[var(--ds-border-subtle)] hover:bg-[var(--ds-bg-hover)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/tenants/${t.id}`} className="font-medium text-[var(--ds-text-primary)] hover:underline">
                      {t.name}
                    </Link>
                    <div className="text-xs text-[var(--ds-text-muted)]">{t.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">{t.plan_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(t.status)}>{statusLabel(t.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">
                    {t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">{usageCell(t.used_contacts, t.max_contacts)}</td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">{usageCell(t.used_templates, t.max_templates)}</td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">{usageCell(t.used_campaigns_month, t.max_campaigns_per_month)}</td>
                  <td className="px-4 py-3 text-[var(--ds-text-secondary)]">{usageCell(t.used_whatsapp_numbers, t.max_whatsapp_numbers)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--ds-text-muted)]">
                    Nenhum tenant encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  )
}
