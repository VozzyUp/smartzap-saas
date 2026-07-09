import { describe, it, expect, vi, beforeEach } from 'vitest'

const signInWithOtp = vi.fn()

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { signInWithOtp },
  }),
}))

vi.mock('@/lib/app-url', () => ({
  getAppUrl: () => 'https://app.example.com',
}))

import { POST } from './route'
import { NextRequest } from 'next/server'

function makeRequest(body: unknown) {
  return new NextRequest('https://app.example.com/api/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/auth/magic-link', () => {
  beforeEach(() => {
    signInWithOtp.mockReset()
  })

  it('retorna 400 quando email não é enviado', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('chama signInWithOtp com o redirect correto e retorna sucesso', async () => {
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: null })
    const res = await POST(makeRequest({ email: 'ana@empresa.com' }))
    expect(res.status).toBe(200)
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'ana@empresa.com',
      options: { emailRedirectTo: 'https://app.example.com/api/auth/callback' },
    })
  })

  it('retorna 400 quando o supabase retorna erro', async () => {
    signInWithOtp.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } })
    const res = await POST(makeRequest({ email: 'ana@empresa.com' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('rate limited')
  })
})
