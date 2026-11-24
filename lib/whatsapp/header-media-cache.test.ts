import { describe, it, expect } from 'vitest'
import { isCachedHeaderMediaIdUsable, HEADER_MEDIA_ID_MAX_AGE_MS } from './header-media-cache'

const NOW = new Date('2026-11-23T12:00:00Z').getTime()
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString()

describe('isCachedHeaderMediaIdUsable', () => {
  const base = { id: 'mid1', cachedHash: 'h1', exampleHash: 'h1', updatedAt: daysAgo(1), now: NOW }

  it('reaproveita media id recente com o mesmo exemplo', () => {
    expect(isCachedHeaderMediaIdUsable(base)).toBe(true)
  })

  it('descarta media id com mais de 25 dias (a Meta expira em 30)', () => {
    expect(isCachedHeaderMediaIdUsable({ ...base, updatedAt: daysAgo(26) })).toBe(false)
    expect(HEADER_MEDIA_ID_MAX_AGE_MS).toBe(25 * 24 * 60 * 60 * 1000)
  })

  it('descarta quando o exemplo mudou (hash diferente)', () => {
    expect(isCachedHeaderMediaIdUsable({ ...base, exampleHash: 'outro' })).toBe(false)
  })

  it('sem data de gravação ou data inválida: não confia no cache', () => {
    expect(isCachedHeaderMediaIdUsable({ ...base, updatedAt: null })).toBe(false)
    expect(isCachedHeaderMediaIdUsable({ ...base, updatedAt: 'lixo' })).toBe(false)
  })

  it('sem id ou sem hash: não usa', () => {
    expect(isCachedHeaderMediaIdUsable({ ...base, id: null })).toBe(false)
    expect(isCachedHeaderMediaIdUsable({ ...base, cachedHash: null })).toBe(false)
  })
})
