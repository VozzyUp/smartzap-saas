import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

const base: any = {
  id: 'msg-9',
  tenant_id: 't1',
  conversation_id: 'c1',
  direction: 'inbound',
  content: '',
  message_type: 'audio',
  media_url: null,
  media_status: 'ready',
  whatsapp_message_id: 'w1',
  delivery_status: 'delivered',
  ai_response_id: null,
  ai_sentiment: null,
  ai_sources: null,
  payload: null,
  created_at: '2026-01-01T12:00:00.000Z',
}

describe('MessageBubble — áudio recebido', () => {
  it('mostra o player apontando para a rota de mídia e a transcrição com rótulo', () => {
    const { container } = render(<MessageBubble message={{ ...base, payload: { transcription: { text: 'quero o preço' } } }} />)
    const src = container.querySelector('audio source')?.getAttribute('src')
    expect(src).toBe('/api/inbox/media/msg-9')
    expect(screen.getByText('Transcrição')).toBeTruthy()
    expect(screen.getByText('quero o preço')).toBeTruthy()
  })
  it('sem transcrição mostra só o player', () => {
    const { container } = render(<MessageBubble message={base} />)
    expect(container.querySelector('audio')).toBeTruthy()
    expect(screen.queryByText('Transcrição')).toBeNull()
  })
  it('mídia ainda recebendo não mostra player nem transcrição', () => {
    const { container } = render(<MessageBubble message={{ ...base, media_status: 'pending' }} />)
    expect(container.querySelector('audio')).toBeNull()
  })
})
