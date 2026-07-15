import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'

// Rota leve consultada por QUALQUER usuário logado (não só admin) para decidir
// se mostra o link "Admin" no menu. Nunca retorna 403 — sempre 200 com o booleano.
export async function GET() {
  let isPlatformAdmin = false
  try {
    const ctx = await getTenantContext()
    isPlatformAdmin = !!ctx?.isPlatformAdmin
  } catch {
    isPlatformAdmin = false
  }
  return NextResponse.json({ isPlatformAdmin })
}
