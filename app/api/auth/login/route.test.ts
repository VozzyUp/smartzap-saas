import { describe, it, expect, vi, beforeEach } from 'vitest'
const signInWithPassword = vi.fn()
vi.mock('@/lib/supabase-server', () => ({ createClient: async () => ({ auth: { signInWithPassword } }) }))
import { POST } from './route'

const req = (body: unknown) => new Request('http://x/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/auth/login', () => {
  beforeEach(() => signInWithPassword.mockReset())
  it('200 com credenciais válidas', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const res = await POST(req({ email: 'a@b.com', password: 'senha123' }) as any)
    expect(res.status).toBe(200)
  })
  it('401 com credencial inválida — mensagem genérica', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } })
    const res = await POST(req({ email: 'a@b.com', password: 'errada' }) as any)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('E-mail ou senha inválidos')
  })
  it('400 sem email ou senha', async () => {
    const res = await POST(req({ email: 'a@b.com' }) as any)
    expect(res.status).toBe(400)
  })
})
