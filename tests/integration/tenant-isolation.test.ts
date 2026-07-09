/**
 * Teste de integração — isolamento entre 2 tenants (Fase 2A, Task 12).
 *
 * Este teste NÃO é mockado: ele fala com um Supabase real (dev/staging).
 * Por isso está sob `tests/integration/` e é pulado automaticamente quando
 * as credenciais do Supabase não estão configuradas no ambiente (ver
 * `isSupabaseConfigured()` em `lib/supabase.ts`).
 *
 * Para rodar de verdade:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *     npx vitest run tests/integration/tenant-isolation.test.ts
 * (ou popule `.env.local` com essas variáveis — o vitest.config.ts já as carrega)
 *
 * Cobertura:
 *  1) Camada de dados (contactDb): 2 tenants, 1 contato cada, cada tenant só
 *     enxerga o seu via `contactDb.getAll(tenantId)`.
 *  2) RLS real: como não há Supabase local rodando neste ambiente (sem CLI
 *     `supabase` instalada) nem uma connection string de Postgres disponível
 *     (só a Service Role API key), NÃO é possível abrir uma conexão `pg` direta
 *     para simular `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims`
 *     a partir deste processo de teste. Essa simulação foi feita manualmente
 *     uma vez via MCP (que conecta como `postgres` superuser) contra o projeto
 *     real, confirmando que um usuário autenticado sem `tenant_members` não
 *     enxerga nenhuma linha das tabelas com `tenant_isolation_*`. Ver
 *     `.superpowers/sdd/task-12-report.md` para o registro dessa verificação
 *     e a limitação de não conseguir simular 2 usuários JWT reais dentro do
 *     próprio teste automatizado (não há infra de Supabase local nem uma
 *     DATABASE_URL com credenciais de Postgres neste projeto).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { contactDb } from '@/lib/supabase-db'
import { ContactStatus } from '@/types'

const RUN = isSupabaseConfigured()

describe.skipIf(!RUN)('tenant isolation (data layer)', () => {
    let tenantAId: string
    let tenantBId: string
    let contactAId: string
    let contactBId: string

    beforeAll(async () => {
        const admin = getSupabaseAdmin()
        if (!admin) throw new Error('Supabase admin client not configured')

        const { data: tenantA, error: errA } = await admin
            .from('tenants')
            .insert({ name: 'Tenant A (task-12 test)', slug: `tenant-a-task12-${Date.now()}` })
            .select('id')
            .single()
        if (errA) throw errA
        tenantAId = tenantA.id

        const { data: tenantB, error: errB } = await admin
            .from('tenants')
            .insert({ name: 'Tenant B (task-12 test)', slug: `tenant-b-task12-${Date.now()}` })
            .select('id')
            .single()
        if (errB) throw errB
        tenantBId = tenantB.id

        const contactA = await contactDb.add(tenantAId, {
            name: 'Contato A',
            phone: '+5511900000101',
            email: null,
            status: ContactStatus.OPT_IN,
            tags: [],
            custom_fields: {},
        })
        contactAId = contactA.id

        const contactB = await contactDb.add(tenantBId, {
            name: 'Contato B',
            phone: '+5511900000102',
            email: null,
            status: ContactStatus.OPT_IN,
            tags: [],
            custom_fields: {},
        })
        contactBId = contactB.id
    })

    afterAll(async () => {
        const admin = getSupabaseAdmin()
        if (!admin) return

        // Limpeza best-effort — não falha o teste se algo já tiver sido removido.
        if (contactAId) await admin.from('contacts').delete().eq('id', contactAId).eq('tenant_id', tenantAId)
        if (contactBId) await admin.from('contacts').delete().eq('id', contactBId).eq('tenant_id', tenantBId)
        if (tenantAId) await admin.from('tenants').delete().eq('id', tenantAId)
        if (tenantBId) await admin.from('tenants').delete().eq('id', tenantBId)
    })

    it('contactDb.getAll(tenantA) retorna só o contato de A', async () => {
        const contacts = await contactDb.getAll(tenantAId)
        expect(contacts.map((c) => c.id)).toEqual([contactAId])
        expect(contacts.map((c) => c.id)).not.toContain(contactBId)
    })

    it('contactDb.getAll(tenantB) retorna só o contato de B', async () => {
        const contacts = await contactDb.getAll(tenantBId)
        expect(contacts.map((c) => c.id)).toEqual([contactBId])
        expect(contacts.map((c) => c.id)).not.toContain(contactAId)
    })
})

describe.skipIf(RUN)('tenant isolation (data layer) — skipped', () => {
    it('requer NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY configurados', () => {
        expect(isSupabaseConfigured()).toBe(false)
    })
})
