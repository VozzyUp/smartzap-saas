import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingle = vi.fn()
const upsert = vi.fn()
const deleteEq = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'platform_settings') {
        throw new Error(`unexpected table: ${table}`)
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle }),
        }),
        upsert,
        delete: () => ({ eq: deleteEq }),
      }
    },
  }),
}))

import { platformSettingsDb } from '@/lib/platform-settings'

describe('platformSettingsDb', () => {
  beforeEach(() => {
    maybeSingle.mockReset()
    upsert.mockReset()
    deleteEq.mockReset()
  })

  describe('get', () => {
    it('retorna o value quando a chave existe', async () => {
      maybeSingle.mockResolvedValueOnce({ data: { value: { foo: 'bar' } }, error: null })
      const result = await platformSettingsDb.get('vercel_project_id')
      expect(result).toEqual({ foo: 'bar' })
    })

    it('retorna null quando a chave não existe', async () => {
      maybeSingle.mockResolvedValueOnce({ data: null, error: null })
      const result = await platformSettingsDb.get('missing_key')
      expect(result).toBeNull()
    })

    it('retorna null e não lança quando há erro do Supabase', async () => {
      maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      const result = await platformSettingsDb.get('any_key')
      expect(result).toBeNull()
    })
  })

  describe('set', () => {
    it('faz upsert com key/value/updated_at', async () => {
      upsert.mockResolvedValueOnce({ error: null })
      await platformSettingsDb.set('session_tokens', { ttl: 3600 })

      expect(upsert).toHaveBeenCalledTimes(1)
      const [row, opts] = upsert.mock.calls[0]
      expect(row.key).toBe('session_tokens')
      expect(row.value).toEqual({ ttl: 3600 })
      expect(row.updated_at).toEqual(expect.any(String))
      expect(opts).toEqual({ onConflict: 'key' })
    })

    it('lança quando o Supabase retorna erro', async () => {
      upsert.mockResolvedValueOnce({ error: { message: 'fail' } })
      await expect(platformSettingsDb.set('k', 'v')).rejects.toBeTruthy()
    })
  })

  describe('delete', () => {
    it('deleta pela key', async () => {
      deleteEq.mockResolvedValueOnce({ error: null })
      await platformSettingsDb.delete('session_tokens')
      expect(deleteEq).toHaveBeenCalledWith('key', 'session_tokens')
    })

    it('lança quando o Supabase retorna erro', async () => {
      deleteEq.mockResolvedValueOnce({ error: { message: 'fail' } })
      await expect(platformSettingsDb.delete('k')).rejects.toBeTruthy()
    })
  })
})
