import { SubmissionsClientWrapper } from './SubmissionsClientWrapper'
import { getSubmissionsInitialData } from './actions'

// Dados por-tenant (via cookies/getTenantContext) — nunca cache por tempo.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  searchParams: Promise<{ campaignId?: string; flowId?: string }>
}

export default async function SubmissionsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const campaignId = params.campaignId
  const flowId = params.flowId

  // Fetch inicial no servidor
  const initialData = await getSubmissionsInitialData({ campaignId, flowId })

  return (
    <SubmissionsClientWrapper
      initialData={initialData}
      campaignId={campaignId}
      flowId={flowId}
    />
  )
}
