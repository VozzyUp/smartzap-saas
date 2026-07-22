import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AddNumberForm } from './page'

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function fillForm() {
  fireEvent.change(screen.getByLabelText(/ID do número/i), { target: { value: 'pn_1' } })
  fireEvent.change(screen.getByLabelText(/ID da conta comercial/i), { target: { value: 'waba_1' } })
  fireEvent.change(screen.getByLabelText(/Token de acesso/i), { target: { value: 'tok_1' } })
}

function isDisabled(el: HTMLElement) {
  return (el as HTMLButtonElement).disabled === true
}

/** `api.post` lê `response.headers.get('content-length')` — o mock precisa desse shape. */
function mockFetchResponse(ok: boolean, body: unknown) {
  return {
    ok,
    status: ok ? 200 : 400,
    headers: { get: () => null },
    json: async () => body,
  }
}

describe('AddNumberForm — botão Testar Conexão', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('botão Testar fica desabilitado até os 3 campos obrigatórios serem preenchidos', () => {
    renderWithQueryClient(<AddNumberForm onSuccess={() => {}} />)

    const testButton = screen.getByRole('button', { name: /testar conexão/i })
    expect(isDisabled(testButton)).toBe(true)

    fillForm()

    expect(isDisabled(testButton)).toBe(false)
  })

  it('botão Adicionar Número fica desabilitado antes de testar com sucesso', () => {
    renderWithQueryClient(<AddNumberForm onSuccess={() => {}} />)
    fillForm()

    const addButton = screen.getByRole('button', { name: /^Adicionar Número$/i })
    expect(isDisabled(addButton)).toBe(true)
  })

  it('teste com sucesso mostra o número resolvido e libera o botão Adicionar', async () => {
    ;(fetch as any).mockResolvedValueOnce(
      mockFetchResponse(true, {
        ok: true,
        displayPhoneNumber: '+55 11 91234-5678',
        verifiedName: 'Loja da Maria',
      })
    )

    renderWithQueryClient(<AddNumberForm onSuccess={() => {}} />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /testar conexão/i }))

    await waitFor(() => {
      expect(screen.getByText('+55 11 91234-5678')).not.toBeNull()
    })
    expect(screen.getByText(/Loja da Maria/)).not.toBeNull()

    const addButton = screen.getByRole('button', { name: /^Adicionar Número$/i })
    expect(isDisabled(addButton)).toBe(false)

    expect(fetch).toHaveBeenCalledWith(
      '/api/settings/test-connection',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phoneNumberId: 'pn_1', businessAccountId: 'waba_1', accessToken: 'tok_1' }),
      })
    )
  })

  it('teste com falha mostra o erro e mantém Adicionar desabilitado', async () => {
    ;(fetch as any).mockResolvedValueOnce(mockFetchResponse(false, { error: 'Token inválido ou expirado' }))

    renderWithQueryClient(<AddNumberForm onSuccess={() => {}} />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /testar conexão/i }))

    await waitFor(() => {
      expect(screen.getByText(/Token inválido ou expirado/)).not.toBeNull()
    })

    const addButton = screen.getByRole('button', { name: /^Adicionar Número$/i })
    expect(isDisabled(addButton)).toBe(true)
  })

  it('editar um campo depois de testar com sucesso invalida o teste (precisa testar de novo)', async () => {
    ;(fetch as any).mockResolvedValueOnce(
      mockFetchResponse(true, { ok: true, displayPhoneNumber: '+55 11 91234-5678', verifiedName: null })
    )

    renderWithQueryClient(<AddNumberForm onSuccess={() => {}} />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /testar conexão/i }))

    await waitFor(() => {
      expect(isDisabled(screen.getByRole('button', { name: /^Adicionar Número$/i }))).toBe(false)
    })

    fireEvent.change(screen.getByLabelText(/Token de acesso/i), { target: { value: 'tok_2' } })

    expect(isDisabled(screen.getByRole('button', { name: /^Adicionar Número$/i }))).toBe(true)
  })
})
