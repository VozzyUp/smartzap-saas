import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const state: { suppression: any } = { suppression: null }
vi.mock('@/hooks/usePhoneSuppression', () => ({
  usePhoneSuppression: () => ({ suppression: state.suppression, release: vi.fn(), isReleasing: false }),
}))

import { SuppressionNotice } from './SuppressionNotice'

describe('SuppressionNotice', () => {
  beforeEach(() => {
    state.suppression = null
  })

  it('aparece para número bloqueado por pedido do contato', () => {
    state.suppression = { phone: '+5511999990001', source: 'inbound_keyword', reason: null }
    render(<SuppressionNotice phone="+5511999990001" />)
    expect(screen.getByText('A IA não responde este contato porque ele pediu para parar.')).toBeTruthy()
  })

  it('não aparece para número liberado', () => {
    render(<SuppressionNotice phone="+5511999990001" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('não aparece para falha de entrega', () => {
    state.suppression = { phone: '+5511999990001', source: 'auto_failure_policy', reason: null }
    render(<SuppressionNotice phone="+5511999990001" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
