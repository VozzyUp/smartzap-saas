import { describe, expect, it } from 'vitest'
import { cosineSimilarity } from './rag-store'

describe('cosineSimilarity', () => {
  it('devolve 1 para vetores iguais e 0 para ortogonais', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
  it('não divide por zero com vetor nulo', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})
