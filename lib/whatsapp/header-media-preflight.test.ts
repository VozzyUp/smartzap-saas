import { describe, it, expect } from 'vitest'
import { evaluateHeaderMediaReadiness } from './header-media-preflight'

const base = {
  headerFormat: 'IMAGE',
  providedMediaId: null as string | null,
  resolvedMediaId: null as string | null,
  exampleLink: 'https://scontent.whatsapp.net/v/t61/img.jpg' as string | null,
  exampleIsMetaWeblink: false,
}

describe('evaluateHeaderMediaReadiness', () => {
  it('modelo sem cabeçalho de mídia: sempre ok', () => {
    expect(evaluateHeaderMediaReadiness({ ...base, headerFormat: undefined, exampleLink: null }).ok).toBe(true)
    expect(evaluateHeaderMediaReadiness({ ...base, headerFormat: 'TEXT', exampleLink: null }).ok).toBe(true)
  })
  it('mídia própria informada: ok', () => {
    expect(evaluateHeaderMediaReadiness({ ...base, providedMediaId: '123', exampleLink: null }).ok).toBe(true)
  })
  it('media id gerado a partir do exemplo: ok', () => {
    expect(evaluateHeaderMediaReadiness({ ...base, resolvedMediaId: '999', exampleIsMetaWeblink: true }).ok).toBe(true)
  })
  it('sem media id e exemplo em link público comum: ok (envia por link)', () => {
    expect(evaluateHeaderMediaReadiness(base).ok).toBe(true)
  })
  it('sem media id e exemplo é weblink da Meta (expira/exige auth): falha com mensagem clara', () => {
    const r = evaluateHeaderMediaReadiness({ ...base, exampleIsMetaWeblink: true })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toMatch(/imagem/i)
      expect(r.message).toMatch(/Enviar com este arquivo/)
    }
  })
  it('sem media id e sem exemplo: falha', () => {
    expect(evaluateHeaderMediaReadiness({ ...base, exampleLink: null }).ok).toBe(false)
  })
  it('nomeia vídeo e documento', () => {
    const v = evaluateHeaderMediaReadiness({ ...base, headerFormat: 'VIDEO', exampleLink: null })
    expect(!v.ok && v.message).toMatch(/vídeo/i)
    const d = evaluateHeaderMediaReadiness({ ...base, headerFormat: 'DOCUMENT', exampleLink: null })
    expect(!d.ok && d.message).toMatch(/documento/i)
  })
})
