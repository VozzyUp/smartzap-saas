import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CampaignDailyLimitCard } from './CampaignDailyLimitCard'

function mockFetch(initial: number) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      return { ok: true, status: 200, json: async () => ({ ok: true, limit: body.limit }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, limit: initial }) }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('CampaignDailyLimitCard', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('carrega e mostra o limite salvo', async () => {
    mockFetch(30)
    render(<CampaignDailyLimitCard />)
    const input = (await screen.findByLabelText('Limite de envios por dia')) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('30'))
  })

  it('sem limite configurado o campo fica vazio e o texto explica', async () => {
    mockFetch(0)
    render(<CampaignDailyLimitCard />)
    const input = (await screen.findByLabelText('Limite de envios por dia')) as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.getByText(/Deixe vazio para não limitar/)).toBeTruthy()
  })

  it('salva o novo valor', async () => {
    const fetchMock = mockFetch(0)
    render(<CampaignDailyLimitCard />)
    const input = await screen.findByLabelText('Limite de envios por dia')
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, i]) => (i as any)?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String((post![1] as any).body))).toEqual({ limit: 15 })
    })
  })
})
