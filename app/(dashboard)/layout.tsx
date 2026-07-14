import { redirect } from 'next/navigation'
import { getTenantContext } from '@/lib/tenant-context'
import { DashboardShell } from './DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getTenantContext()
  if (ctx?.trialExpired) redirect('/trial-expirado')
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
