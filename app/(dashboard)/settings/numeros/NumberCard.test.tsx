import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { NumberCard } from './page'

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function baseNumber(overrides: Partial<Parameters<typeof NumberCard>[0]['number']> = {}) {
  return {
    phone_number_id: 'pn_1',
    tenant_id: 't1',
    business_account_id: 'ba_1',
    display_label: null,
    display_phone_number: '+55 11 91234-5678',
    is_active: true,
    connection_type: null,
    ...overrides,
  }
}

describe('NumberCard — badge de tipo de número', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mostra badge "API oficial" quando connection_type=official_api', () => {
    renderWithQueryClient(
      <NumberCard
        number={baseNumber({ connection_type: 'official_api' })}
        onActivate={() => {}}
        onRemove={() => {}}
        isActivating={false}
        isRemoving={false}
      />
    )
    expect(screen.getByText('API oficial')).not.toBeNull()
  })

  it('mostra badge "Coexistência" quando connection_type=coexistence', () => {
    renderWithQueryClient(
      <NumberCard
        number={baseNumber({ connection_type: 'coexistence' })}
        onActivate={() => {}}
        onRemove={() => {}}
        isActivating={false}
        isRemoving={false}
      />
    )
    expect(screen.getByText('Coexistência')).not.toBeNull()
  })

  it('não mostra badge de tipo quando connection_type é null (retrocompat)', () => {
    renderWithQueryClient(
      <NumberCard
        number={baseNumber({ connection_type: null })}
        onActivate={() => {}}
        onRemove={() => {}}
        isActivating={false}
        isRemoving={false}
      />
    )
    expect(screen.queryByText('API oficial')).toBeNull()
    expect(screen.queryByText('Coexistência')).toBeNull()
  })
})
