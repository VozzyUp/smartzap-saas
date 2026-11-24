import { describe, it, expect, vi, beforeEach } from 'vitest'

const addMemories = vi.fn()
vi.mock('@mem0/vercel-ai-provider', () => ({
  addMemories: (...a: unknown[]) => addMemories(...a),
  getMemories: vi.fn(),
}))
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    get: async (_t: string, key: string) => (key === 'mem0_enabled' ? 'true' : 'key-123'),
  },
}))

import { saveInteractionMemory } from './mem0-client'

describe('saveInteractionMemory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('envia instruções de extração em português do Brasil', async () => {
    addMemories.mockResolvedValue({})
    const ok = await saveInteractionMemory('t1', [{ role: 'user', content: 'oi' }], { user_id: '5511' })
    expect(ok).toBe(true)
    const cfg = addMemories.mock.calls[0][1]
    expect(cfg.custom_instructions).toMatch(/português do Brasil/)
    expect(cfg.custom_instructions).toMatch(/Cliente/)
    expect(cfg.user_id).toBe('5511')
  })
})
