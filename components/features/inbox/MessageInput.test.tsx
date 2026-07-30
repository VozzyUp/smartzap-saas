import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MessageInput } from './MessageInput'

vi.mock('./QuickRepliesPopover', () => ({
  QuickRepliesPopover: () => null,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('MessageInput', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:image-preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('atualiza as mensagens depois de enviar uma imagem', async () => {
    const onAttachmentSent = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <MessageInput
        onSend={vi.fn()}
        isSending={false}
        quickReplies={[]}
        conversationId="conversation-1"
        {...({ onAttachmentSent } as any)}
      />
    )

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['image'], 'foto.png', { type: 'image/png' })] },
    })

    await screen.findByText('foto.png')
    fireEvent.click(screen.getByTitle('Enviar'))

    await waitFor(() => expect(onAttachmentSent).toHaveBeenCalledTimes(1))
  })
})
