import { Suspense } from 'react'
import { getCampaignsInitialData } from './actions'
import { CampaignsClientWrapper } from './CampaignsClientWrapper'
import { CampaignsSkeleton } from '@/components/features/campaigns/CampaignsSkeleton'

// Dados por-tenant (via cookies/getTenantContext) — nunca cache por tempo,
// senão o card do dashboard mostra um total que esta lista ainda não reflete.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Componente async que busca dados no servidor e passa para o cliente.
 */
async function CampaignsWithData() {
  const initialData = await getCampaignsInitialData()
  return <CampaignsClientWrapper initialData={initialData} />
}

/**
 * Campaigns Page - RSC Híbrido
 *
 * Arquitetura:
 * 1. Servidor busca primeira página + folders + tags
 * 2. HTML é enviado com dados já presentes
 * 3. Cliente hidrata com initialData (sem loading spinner)
 * 4. React Query assume e mantém dados atualizados
 */
export default function CampaignsPage() {
  return (
    <Suspense fallback={<CampaignsSkeleton />}>
      <CampaignsWithData />
    </Suspense>
  )
}
