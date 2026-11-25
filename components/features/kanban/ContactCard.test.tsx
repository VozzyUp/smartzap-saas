import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const push = vi.fn()
const info = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { info: (...a: any[]) => info(...a), error: vi.fn() } }))
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))
vi.mock('./CardAutomationDialog', () => ({ CardAutomationDialog: () => null }))

import { ContactCard } from './ContactCard'

const base: any = {
  id: 'k1', tenant_id: 't', board_id: 'b', stage_id: 's', contact_id: 'c1', position: 0,
  moved_at: new Date().toISOString(),
  contact: { id: 'c1', name: 'Maria', phone: '+5521999999999' },
}

describe('ContactCard', () => {
  beforeEach(() => { push.mockClear(); info.mockClear() })

  it('clique navega para a conversa', () => {
    render(<ContactCard card={{ ...base, conversation_id: 'v9' }} />)
    fireEvent.click(screen.getByLabelText('Abrir conversa de Maria'))
    expect(push).toHaveBeenCalledWith('/inbox/v9')
  })

  it('Enter e Espaço abrem a conversa', () => {
    render(<ContactCard card={{ ...base, conversation_id: 'v9' }} />)
    const el = screen.getByLabelText('Abrir conversa de Maria')
    fireEvent.keyDown(el, { key: 'Enter' })
    fireEvent.keyDown(el, { key: ' ' })
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('clique no botão de histórico não navega', () => {
    render(<ContactCard card={{ ...base, conversation_id: 'v9' }} />)
    fireEvent.click(screen.getByLabelText('Ver histórico de automação'))
    expect(push).not.toHaveBeenCalled()
  })

  it('contato sem conversa mostra aviso e não navega', () => {
    render(<ContactCard card={{ ...base, conversation_id: null }} />)
    fireEvent.click(screen.getByLabelText('Abrir conversa de Maria'))
    expect(push).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith('Este contato ainda não tem conversa.')
  })
})
