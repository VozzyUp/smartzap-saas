import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FunnelStageSelect } from './FunnelStageSelect'

function mockBoards(boards: any[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ boards }) })))
}

describe('FunnelStageSelect', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('não aparece quando a conta não tem quadro', async () => {
    mockBoards([])
    const { container } = render(<FunnelStageSelect value={null} onChange={() => {}} />)
    await waitFor(() => expect((fetch as any).mock.calls.length).toBe(1))
    expect(container.textContent).toBe('')
  })

  it('com um quadro, escolhe só a fase e devolve quadro+fase', async () => {
    mockBoards([{ id: 'b1', name: 'Funil', stages: [{ id: 's1', name: 'Contatado' }, { id: 's2', name: 'Cliente' }] }])
    const onChange = vi.fn()
    render(<FunnelStageSelect value={null} onChange={onChange} />)
    const select = await screen.findByLabelText('Fase do funil')
    expect(screen.queryByLabelText('Quadro do funil')).toBeNull()
    fireEvent.change(select, { target: { value: 's1' } })
    expect(onChange).toHaveBeenCalledWith({ boardId: 'b1', stageId: 's1' })
  })

  it('"Não colocar no funil" limpa a escolha', async () => {
    mockBoards([{ id: 'b1', name: 'Funil', stages: [{ id: 's1', name: 'Contatado' }] }])
    const onChange = vi.fn()
    render(<FunnelStageSelect value={{ boardId: 'b1', stageId: 's1' }} onChange={onChange} />)
    const select = await screen.findByLabelText('Fase do funil')
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('com vários quadros mostra o seletor de quadro', async () => {
    mockBoards([
      { id: 'b1', name: 'A', stages: [{ id: 's1', name: 'X' }] },
      { id: 'b2', name: 'B', stages: [{ id: 's9', name: 'Y' }] },
    ])
    const onChange = vi.fn()
    render(<FunnelStageSelect value={null} onChange={onChange} />)
    const board = await screen.findByLabelText('Quadro do funil')
    fireEvent.change(board, { target: { value: 'b2' } })
    expect(onChange).toHaveBeenCalledWith({ boardId: 'b2', stageId: 's9' })
  })
})
