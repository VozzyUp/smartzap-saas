import { describe, it, expect } from 'vitest'
import { describeMessageForAI } from './chat-agent'

describe('describeMessageForAI', () => {
  it('nunca devolve texto vazio para mídia recebida sem legenda', () => {
    for (const t of ['audio', 'image', 'video', 'document', 'sticker', 'desconhecido']) {
      const out = describeMessageForAI({ content: '', message_type: t, direction: 'inbound' })
      expect(out.trim().length).toBeGreaterThan(0)
    }
    expect(describeMessageForAI({ content: null, message_type: 'audio', direction: 'inbound' })).toContain('um áudio')
  })
  it('mantém o texto normal intacto', () => {
    expect(describeMessageForAI({ content: 'oi', message_type: 'text', direction: 'inbound' })).toBe('oi')
  })
  it('informa o tipo quando a mídia vem com legenda ou transcrição', () => {
    expect(describeMessageForAI({ content: 'quero agendar', message_type: 'audio', direction: 'inbound' })).toBe('[O contato enviou um áudio] quero agendar')
  })
  it('mídia enviada por nós sem texto também não fica vazia', () => {
    expect(describeMessageForAI({ content: '  ', message_type: 'image', direction: 'outbound' })).toBe('[Enviamos uma imagem]')
  })
})
