import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MetaAppIdInline } from './MetaAppIdInline'

describe('MetaAppIdInline', () => {
  it('botão desabilitado até o ID ter só números (5 a 20)', () => {
    render(<MetaAppIdInline onSave={async () => {}} />)
    const btn = screen.getByRole('button', { name: /Salvar/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('ID do Aplicativo da Meta'), { target: { value: 'abc123' } })
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('ID do Aplicativo da Meta'), { target: { value: '123456789' } })
    expect(btn.disabled).toBe(false)
  })

  it('salva o ID sem espaços e limpa o campo', async () => {
    const onSave = vi.fn(async () => {})
    render(<MetaAppIdInline onSave={onSave} />)
    const input = screen.getByLabelText('ID do Aplicativo da Meta') as HTMLInputElement
    fireEvent.change(input, { target: { value: ' 123456789 ' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('123456789'))
    await waitFor(() => expect(input.value).toBe(''))
  })
})
