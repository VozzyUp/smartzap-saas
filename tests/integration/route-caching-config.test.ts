import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Bug real: rotas/páginas que resolvem tenant via cookies (getTenantContext)
// mas usam `export const revalidate = N` (ISR por tempo) em vez de
// force-dynamic ficam com cache de servidor por até N segundos — dados
// de UM tenant podem ser servidos a outro request na mesma janela, e o
// dashboard pode mostrar um agregado mais "velho" que a lista abaixo dele
// (sintoma relatado: card do dashboard não bate com a lista de campanhas).
//
// contacts/page.tsx já usa o padrão correto (force-dynamic + revalidate 0)
// — é a referência que as demais páginas seguem aqui.
const TENANT_SCOPED_ROUTES = [
  'app/api/dashboard/stats/route.ts',
  'app/(dashboard)/page.tsx',
  'app/(dashboard)/campaigns/page.tsx',
  'app/(dashboard)/forms/page.tsx',
  'app/(dashboard)/inbox/page.tsx',
  'app/(dashboard)/submissions/page.tsx',
  'app/api/custom-fields/route.ts',
  'app/api/flows/route.ts',
  'app/api/templates/route.ts',
]

function readRoute(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

describe('cache de rotas/páginas por-tenant', () => {
  it.each(TENANT_SCOPED_ROUTES)('%s é force-dynamic (nunca cache por tempo/ISR)', (relativePath) => {
    const content = readRoute(relativePath)
    expect(content).toMatch(/export const dynamic = ['"]force-dynamic['"]/)
    expect(content).toMatch(/export const revalidate = 0\b/)
  })

  it('referência: contacts/page.tsx já segue o padrão correto', () => {
    const content = readRoute('app/(dashboard)/contacts/page.tsx')
    expect(content).toMatch(/export const dynamic = ['"]force-dynamic['"]/)
    expect(content).toMatch(/export const revalidate = 0\b/)
  })
})
