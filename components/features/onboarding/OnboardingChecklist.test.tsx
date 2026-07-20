import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { HealthStatus } from '@/lib/health-check'

vi.mock('./hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({
    progress: { isChecklistMinimized: false },
    shouldShowChecklist: true,
    minimizeChecklist: vi.fn(),
    dismissChecklist: vi.fn(),
  }),
}))

import { OnboardingChecklist } from './OnboardingChecklist'

function healthStatusAllOk(): HealthStatus {
  return {
    services: {
      whatsapp: { status: 'ok' },
      webhook: { status: 'ok' },
    },
  } as unknown as HealthStatus
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    // Setup já 100% completo no banco (permanentTokenConfirmed: true) — busca
    // async ainda não resolveu no instante do primeiro paint.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ permanentTokenConfirmed: true }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('não pisca o card em 67% antes da busca async do status do token resolver (bug: flash de conteúdo errado a cada F5)', () => {
    render(<OnboardingChecklist healthStatus={healthStatusAllOk()} />)

    // Ainda no primeiro paint síncrono, antes do fetch resolver: setup já está
    // 100% completo no banco, então o card não deve aparecer com 67%.
    expect(screen.queryByText('Complete sua configuração')).toBeNull()
  })

  it('mostra o card depois que o fetch resolve, se o setup realmente estiver incompleto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ permanentTokenConfirmed: false }),
    }))

    render(<OnboardingChecklist healthStatus={healthStatusAllOk()} />)

    expect(await screen.findByText('Complete sua configuração')).not.toBeNull()
    expect(screen.getByText('67%')).not.toBeNull()
  })
})
