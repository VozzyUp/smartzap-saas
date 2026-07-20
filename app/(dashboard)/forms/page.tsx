import { Suspense } from 'react'
import { getFormsInitialData } from './actions'
import { FormsClientWrapper } from './FormsClientWrapper'
import { FormsSkeleton } from '@/components/features/lead-forms/FormsSkeleton'

// Dados por-tenant (via cookies/getTenantContext) — nunca cache por tempo.
export const dynamic = 'force-dynamic'
export const revalidate = 0

async function FormsWithData() {
  const initialData = await getFormsInitialData()
  return <FormsClientWrapper initialData={initialData} />
}

/**
 * Forms Page - RSC Híbrido
 */
export default function FormsPage() {
  return (
    <Suspense fallback={<FormsSkeleton />}>
      <FormsWithData />
    </Suspense>
  )
}
