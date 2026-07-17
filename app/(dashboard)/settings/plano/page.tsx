'use client'

import { useQuery } from '@tanstack/react-query'
import { Page, PageHeader, PageTitle, PageDescription, PageSection } from '@/components/ui/page'
import { PlanUsageBars } from '@/components/features/plan/PlanUsageBars'
import { PlanComparison, type CatalogPlan } from '@/components/features/plan/PlanComparison'
import type { PlanUsage } from '@/lib/plan-usage'
import { Loader2 } from 'lucide-react'

function formatPrice(priceCents: number | null, slug: string): string {
  if (priceCents === null) {
    return slug === 'trial' ? 'Grátis' : 'Sob consulta'
  }
  return `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}/mês`
}

export default function MeuPlanoPage() {
  const { data: plan, isLoading: isPlanLoading } = useQuery<PlanUsage>({
    queryKey: ['plan'],
    queryFn: async () => {
      const response = await fetch('/api/plan')
      if (!response.ok) throw new Error('Failed to fetch plan')
      return response.json()
    },
    staleTime: 30000,
  })

  const { data: catalog, isLoading: isCatalogLoading } = useQuery<{ plans: CatalogPlan[] }>({
    queryKey: ['plans-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/plans/catalog')
      if (!response.ok) throw new Error('Failed to fetch plans catalog')
      return response.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const isLoading = isPlanLoading || isCatalogLoading

  return (
    <Page>
      <PageHeader>
        <div>
          <PageTitle>Meu Plano</PageTitle>
          <PageDescription>Acompanhe seu uso e compare os planos disponíveis</PageDescription>
        </div>
      </PageHeader>

      {isLoading || !plan ? (
        <div className="flex items-center justify-center py-16 text-[var(--ds-text-muted)]">
          <Loader2 className="animate-spin" size={24} aria-hidden="true" />
          <span className="sr-only">Carregando...</span>
        </div>
      ) : (
        <>
          <PageSection>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-heading-3">{plan.plan.name}</h2>
              <span className="text-[var(--ds-text-secondary)]">
                {formatPrice(plan.plan.price_cents, plan.plan.slug)}
              </span>
              {plan.trial.daysLeft !== null && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-full px-2.5 py-0.5">
                  Trial — {plan.trial.daysLeft} {plan.trial.daysLeft === 1 ? 'dia' : 'dias'} restantes
                </span>
              )}
            </div>
          </PageSection>

          <PageSection>
            <h3 className="text-heading-4 mb-4">Uso vs. Limite</h3>
            <PlanUsageBars usage={plan.usage} />
          </PageSection>

          <PageSection>
            <h3 className="text-heading-4 mb-4">Planos disponíveis</h3>
            <PlanComparison plans={catalog?.plans ?? []} currentSlug={plan.plan.slug} />
          </PageSection>
        </>
      )}
    </Page>
  )
}
