import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
const signUp = vi.fn()
vi.mock('@/lib/supabase-server', () => ({ createClient: async () => ({ auth: { signUp } }) }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))
import { POST } from './route'

// NextRequest (não Request) — a rota lê request.nextUrl.origin.
const req = (body: unknown) => new NextRequest('http://x/api/auth/signup', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/auth/signup', () => {
  beforeEach(() => signUp.mockReset())
  it('200 e emailRedirectTo aponta pro callback', async () => {
    signUp.mockResolvedValue({ data: {}, error: null })
    const res = await POST(req({ email: 'novo@b.com', password: 'senha123' }) as any)
    expect(res.status).toBe(200)
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ emailRedirectTo: 'https://app.test/api/auth/callback' }),
    }))
  })
  it('200 opaco mesmo com e-mail já cadastrado (anti-enumeração)', async () => {
    signUp.mockResolvedValue({ data: {}, error: { message: 'User already registered' } })
    const res = await POST(req({ email: 'ja@b.com', password: 'senha123' }) as any)
    expect(res.status).toBe(200)
  })
  it('400 com senha < 8 chars', async () => {
    const res = await POST(req({ email: 'a@b.com', password: '123' }) as any)
    expect(res.status).toBe(400)
  })
})
