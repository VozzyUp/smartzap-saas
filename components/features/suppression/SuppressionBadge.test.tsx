import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SuppressionBadge } from './SuppressionBadge'

describe('SuppressionBadge', () => {
  it('mostra o texto conforme a origem', () => {
    const { rerender } = render(<SuppressionBadge source="ai_detected" />)
    expect(screen.getByText('Bloqueado · pediu para parar')).toBeTruthy()
    rerender(<SuppressionBadge source="auto_failure_policy" />)
    expect(screen.getByText('Bloqueado · falha de entrega')).toBeTruthy()
    rerender(<SuppressionBadge source={null} />)
    expect(screen.getByText('Bloqueado')).toBeTruthy()
  })

  it('sem onRelease não mostra o botão Liberar', () => {
    render(<SuppressionBadge source="ai_detected" />)
    expect(screen.queryByLabelText('Liberar número bloqueado')).toBeNull()
  })

  it('Liberar pede confirmação e só então chama onRelease', async () => {
    const onRelease = vi.fn()
    render(<SuppressionBadge source="ai_detected" onRelease={onRelease} />)
    fireEvent.click(screen.getByLabelText('Liberar número bloqueado'))
    expect(onRelease).not.toHaveBeenCalled()
    expect(screen.getByText(/Liberar este número\? A IA volta a responder/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Liberar' }))
    await waitFor(() => expect(onRelease).toHaveBeenCalledTimes(1))
  })
})
