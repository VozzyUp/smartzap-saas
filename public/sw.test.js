import { describe, it, expect } from 'vitest'
import { selectStrategy, shouldIgnore } from './sw.js'

function makeRequest({ url, mode = 'same-origin', accept = '' }) {
  return {
    url,
    mode,
    method: 'GET',
    headers: { get: (name) => (name.toLowerCase() === 'accept' ? accept : null) },
  }
}

describe('sw.js shouldIgnore', () => {
  it('ignora /api/ — o listener nem chega a decidir estratégia pra essas rotas', () => {
    expect(shouldIgnore(new URL('https://app.vozzyup.com.br/api/dashboard/stats'))).toBe(true)
  })
})

describe('sw.js selectStrategy', () => {
  it('usa network-first para navegação de páginas (HTML) — nunca stale-while-revalidate', () => {
    // Bug real: stale-while-revalidate devolve o HTML do cache antes de checar
    // a rede, fazendo o usuário ver dados de 1-2 reloads atrás até o cache
    // "alcançar" a rede — sintoma relatado: F5 mostra 1 contato, F5 de novo
    // mostra 5, alternando. Navegação de página tem que ir pra rede primeiro.
    const req = makeRequest({ url: 'https://app.vozzyup.com.br/contacts', mode: 'navigate' })
    const url = new URL(req.url)
    expect(selectStrategy(req, url)).toBe('network-first')
  })

  it('detecta navegação também por Accept: text/html (alguns navegadores não setam mode=navigate)', () => {
    const req = makeRequest({ url: 'https://app.vozzyup.com.br/dashboard', mode: 'same-origin', accept: 'text/html,*/*' })
    const url = new URL(req.url)
    expect(selectStrategy(req, url)).toBe('network-first')
  })

  it('mantém cache-first para assets estáticos do Next', () => {
    const req = makeRequest({ url: 'https://app.vozzyup.com.br/_next/static/chunks/app.js' })
    const url = new URL(req.url)
    expect(selectStrategy(req, url)).toBe('cache-first')
  })

  it('fallback padrão (nem estático nem navegação) é network-first', () => {
    const req = makeRequest({ url: 'https://app.vozzyup.com.br/manifest.json' })
    const url = new URL(req.url)
    expect(selectStrategy(req, url)).toBe('network-first')
  })
})
