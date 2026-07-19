'use client'

import { cn } from '@/lib/utils'
import { Container } from '@/components/ui/container'
import { CheckCircle2, MessageCircle } from 'lucide-react'

export type CatalogPlan = {
  slug: string
  name: string
  price_cents: number | null
  max_contacts: number | null
  max_templates: number | null
  max_campaigns_per_month: number | null
  max_whatsapp_numbers: number | null
}

const WHATSAPP_URL = `https://wa.me/5511976194739?text=${encodeURIComponent(
  'Olá! Quero fazer upgrade do meu plano no V-Smart.'
)}`

function formatPrice(priceCents: number | null, slug: string): string {
  if (priceCents === null) {
    return slug === 'trial' ? 'Grátis' : 'Sob consulta'
  }
  return `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}/mês`
}

function formatLimit(limit: number | null): string {
  return limit === null ? '∞' : String(limit)
}

export function PlanComparison({ plans, currentSlug }: { plans: CatalogPlan[]; currentSlug: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {plans.map((plan) => {
        const isCurrent = plan.slug === currentSlug
        return (
          <Container
            key={plan.slug}
            variant={isCurrent ? 'elevated' : 'default'}
            padding="lg"
            className={cn(
              'flex flex-col',
              isCurrent && 'ring-2 ring-emerald-500/60'
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-heading-4">{plan.name}</h3>
              {isCurrent && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-full px-2.5 py-0.5">
                  <CheckCircle2 size={12} aria-hidden="true" />
                  Atual
                </span>
              )}
            </div>
            <p className="text-lg font-semibold text-[var(--ds-text-primary)] mb-4">
              {formatPrice(plan.price_cents, plan.slug)}
            </p>
            <ul className="space-y-2 text-sm text-[var(--ds-text-secondary)] flex-1">
              <li>Contatos: <span className="font-medium text-[var(--ds-text-primary)]">{formatLimit(plan.max_contacts)}</span></li>
              <li>Templates: <span className="font-medium text-[var(--ds-text-primary)]">{formatLimit(plan.max_templates)}</span></li>
              <li>Campanhas/mês: <span className="font-medium text-[var(--ds-text-primary)]">{formatLimit(plan.max_campaigns_per_month)}</span></li>
              <li>Números de WhatsApp: <span className="font-medium text-[var(--ds-text-primary)]">{formatLimit(plan.max_whatsapp_numbers)}</span></li>
            </ul>
            {!isCurrent && (
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center justify-center gap-2 bg-primary-600 text-white hover:bg-primary-500 dark:bg-white dark:text-black dark:hover:bg-white/90 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
              >
                <MessageCircle size={16} aria-hidden="true" />
                Falar com o time
              </a>
            )}
          </Container>
        )
      })}
    </div>
  )
}
