'use client'

import { useQuery } from '@tanstack/react-query'
import { CreditCard, ArrowUpRight } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { PrefetchLink } from '@/components/ui/PrefetchLink'
import { cn } from '@/lib/utils'
import type { PlanUsage } from '@/lib/plan-usage'

const DIMENSION_LABELS: Record<keyof PlanUsage['usage'], string> = {
  contacts: 'Contatos',
  templates: 'Templates',
  campaignsMonth: 'Campanhas no mês',
  whatsappNumbers: 'Números',
}

function getHighestUsageDimension(usage: PlanUsage['usage']) {
  let best: { key: keyof PlanUsage['usage']; used: number; limit: number | null; ratio: number } | null = null
  for (const key of Object.keys(usage) as (keyof PlanUsage['usage'])[]) {
    const { used, limit } = usage[key]
    if (limit === null) continue
    const ratio = limit > 0 ? used / limit : 1
    if (!best || ratio > best.ratio) {
      best = { key, used, limit, ratio }
    }
  }
  return best
}

export function PlanUsageCard() {
  const { data: plan, isLoading } = useQuery<PlanUsage>({
    queryKey: ['plan'],
    queryFn: async () => {
      const response = await fetch('/api/plan')
      if (!response.ok) throw new Error('Failed to fetch plan')
      return response.json()
    },
    staleTime: 30000,
  })

  if (isLoading || !plan) {
    return (
      <Container variant="glass" padding="lg">
        <div className="animate-pulse space-y-3">
          <div className="w-24 h-4 bg-[var(--ds-bg-surface)] rounded" />
          <div className="w-32 h-6 bg-[var(--ds-bg-surface)] rounded" />
        </div>
      </Container>
    )
  }

  const highest = getHighestUsageDimension(plan.usage)
  const isTrial = plan.trial.daysLeft !== null
  const isAlert = !!highest && highest.limit !== null && highest.limit > 0 && highest.ratio >= 0.9

  return (
    <Container variant="glass" padding="lg">
      <div className="flex items-start justify-between mb-4">
        <div
          className={cn(
            'relative p-3 rounded-xl border border-[var(--ds-border-default)]',
            'bg-emerald-500/20'
          )}
        >
          <CreditCard size={20} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        </div>
      </div>
      <p className="text-stat-label">{plan.plan.name}</p>
      <p className={cn('text-sm mt-1', isAlert ? 'text-[var(--ds-status-error-text)]' : 'text-[var(--ds-text-secondary)]')}>
        {isTrial
          ? `Trial — ${plan.trial.daysLeft} ${plan.trial.daysLeft === 1 ? 'dia' : 'dias'}`
          : highest
            ? `${DIMENSION_LABELS[highest.key]} ${highest.used}/${highest.limit}`
            : 'Uso ilimitado'}
      </p>
      <PrefetchLink
        href="/settings/plano"
        className="mt-4 inline-flex items-center gap-2 text-label-sm hover:text-[var(--ds-text-primary)] transition-colors"
      >
        Ver meu plano <ArrowUpRight size={14} aria-hidden="true" />
      </PrefetchLink>
    </Container>
  )
}
