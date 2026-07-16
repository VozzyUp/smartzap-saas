import { describe, it, expect, vi } from 'vitest'
const requireMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({ requirePlatformAdmin: () => requireMock() }))
// A rota chama a RPC via client de sessão (createClient), não getSupabaseAdmin.
vi.mock('@/lib/supabase-server', () => ({ createClient: async () => ({ rpc: async () => ({ data: [], error: null }) }) }))
import { GET } from './route'
import { NextResponse } from 'next/server'

it('não-admin → 403', async () => {
  requireMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
  const res = await GET()
  expect(res.status).toBe(403)
})
it('admin → 200 com lista', async () => {
  requireMock.mockResolvedValue({ ok: true, ctx: {} })
  const res = await GET()
  expect(res.status).toBe(200)
})
