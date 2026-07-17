'use client'

import { cn } from '@/lib/utils'
import type { PlanUsage } from '@/lib/plan-usage'

type UsageDimension = { used: number; limit: number | null }

const DIMENSIONS: { key: keyof PlanUsage['usage']; label: string }[] = [
  { key: 'contacts', label: 'Contatos' },
  { key: 'templates', label: 'Templates' },
  { key: 'campaignsMonth', label: 'Campanhas no mês' },
  { key: 'whatsappNumbers', label: 'Números de WhatsApp' },
]

function UsageRow({ label, dimension }: { label: string; dimension: UsageDimension }) {
  const { used, limit } = dimension
  const isUnlimited = limit === null
  const pct = isUnlimited ? 0 : limit > 0 ? Math.min(100, (used / limit) * 100) : 100
  const isAlert = !isUnlimited && limit > 0 && used / limit >= 0.9

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--ds-text-secondary)]">{label}</span>
        <span className={cn(
          'font-medium tabular-nums',
          isAlert ? 'text-[var(--ds-status-error-text)]' : 'text-[var(--ds-text-primary)]'
        )}>
          {used}/{isUnlimited ? '∞' : limit}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--ds-bg-surface)] overflow-hidden">
        {isUnlimited ? (
          <div className="h-full w-full bg-[var(--ds-border-default)]" />
        ) : (
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              isAlert ? 'bg-red-500' : 'bg-emerald-500'
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  )
}

export function PlanUsageBars({ usage }: { usage: PlanUsage['usage'] }) {
  return (
    <div className="space-y-5">
      {DIMENSIONS.map((d) => (
        <UsageRow key={d.key} label={d.label} dimension={usage[d.key]} />
      ))}
    </div>
  )
}
