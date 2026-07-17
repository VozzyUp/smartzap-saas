import { describe, it, expect } from 'vitest'
import { formatPlanLimit } from '@/lib/plan-limit-message'

it('traduz cada dimensão', () => {
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'templates', limit: 3, current: 3 }))
    .toBe('Seu plano permite até 3 templates. Faça upgrade para criar mais.')
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'contacts', limit: 100, current: 100 }))
    .toContain('100 contatos')
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'campaigns', limit: 2, current: 2 }))
    .toContain('2 campanhas por mês')
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'whatsapp_numbers', limit: 1, current: 1 }))
    .toContain('1 número de WhatsApp')
})

it('dimensão desconhecida → fallback genérico', () => {
  expect(formatPlanLimit({ error: 'plan_limit', dimension: 'xyz', limit: 5, current: 5 }))
    .toBe('Você atingiu o limite do seu plano. Faça upgrade para continuar.')
})
