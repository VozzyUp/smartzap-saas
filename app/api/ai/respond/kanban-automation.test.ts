import { describe, it, expect, vi, beforeEach } from 'vitest'

const triggerAutomationEventMock = vi.fn()
vi.mock('@/lib/kanban-automation', () => ({
  triggerAutomationEvent: (...a: unknown[]) => triggerAutomationEventMock(...a),
}))

import { triggerKanbanAutomationForAIReply } from './kanban-automation-hook'

describe('triggerKanbanAutomationForAIReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    triggerAutomationEventMock.mockResolvedValue(undefined)
  })

  it('dispara message_sent quando há contact_id', async () => {
    await triggerKanbanAutomationForAIReply('tenant_1', 'contact_1', false)

    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_1', 'message_sent', 'ai')
  })

  it('dispara também quote_detected quando a IA sinalizou detectedQuoteRequest', async () => {
    await triggerKanbanAutomationForAIReply('tenant_1', 'contact_1', true)

    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_1', 'message_sent', 'ai')
    expect(triggerAutomationEventMock).toHaveBeenCalledWith('tenant_1', 'contact_1', 'quote_detected', 'ai')
  })

  it('sem contact_id: não dispara nada', async () => {
    await triggerKanbanAutomationForAIReply('tenant_1', null, true)

    expect(triggerAutomationEventMock).not.toHaveBeenCalled()
  })

  it('falha na automação é best-effort — não propaga o erro', async () => {
    triggerAutomationEventMock.mockRejectedValueOnce(new Error('boom'))

    await expect(triggerKanbanAutomationForAIReply('tenant_1', 'contact_1', false)).resolves.toBeUndefined()
  })
})
