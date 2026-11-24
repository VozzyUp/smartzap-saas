import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetaAppCard } from './MetaAppCard'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function mockFetch(appId: string | null) {
  const fn = vi.fn(async (_u: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) }
    return { ok: true, json: async () => ({ appId }) }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('MetaAppCard', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('sem ID salvo mostra "Não informado"', async () => {
    mockFetch(null)
    render(<MetaAppCard />)
    await screen.findByText('Não informado')
    expect(screen.getByText(/developers\.facebook\.com/)).toBeTruthy()
  })

  it('com ID salvo mostra "Salvo" e o valor', async () => {
    mockFetch('123456789')
    render(<MetaAppCard />)
    await screen.findByText('Salvo')
    expect((screen.getByLabelText('ID do Aplicativo') as HTMLInputElement).value).toBe('123456789')
  })

  it('salva um ID novo', async () => {
    const fetchMock = mockFetch(null)
    render(<MetaAppCard />)
    await screen.findByText('Não informado')
    fireEvent.change(screen.getByLabelText('ID do Aplicativo'), { target: { value: '987654321' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, i]) => (i as any)?.method === 'POST')
      expect(JSON.parse(String((post![1] as any).body))).toEqual({ appId: '987654321' })
    })
    await screen.findByText('Salvo')
  })
})
