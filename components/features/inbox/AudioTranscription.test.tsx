import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AudioTranscription, getAudioTranscription } from './AudioTranscription'

describe('AudioTranscription', () => {
  it('mostra o rótulo Transcrição e o texto', () => {
    render(<AudioTranscription payload={{ transcription: { text: ' quero o preço ' } }} />)
    expect(screen.getByText('Transcrição')).toBeTruthy()
    expect(screen.getByText('quero o preço')).toBeTruthy()
  })
  it('não renderiza nada sem transcrição, com erro ou payload nulo', () => {
    const a = render(<AudioTranscription payload={null} />)
    expect(a.container.innerHTML).toBe('')
    const b = render(<AudioTranscription payload={{ transcription_error: 'no_provider' }} />)
    expect(b.container.innerHTML).toBe('')
    const c = render(<AudioTranscription payload={{ transcription: { text: '  ' } }} />)
    expect(c.container.innerHTML).toBe('')
  })
  it('getAudioTranscription tolera formatos inesperados', () => {
    expect(getAudioTranscription({ transcription: 'x' })).toBeNull()
    expect(getAudioTranscription(undefined)).toBeNull()
  })
})
