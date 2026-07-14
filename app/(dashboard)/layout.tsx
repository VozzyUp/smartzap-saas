import { redirect } from 'next/navigation'
import { getTenantContext } from '@/lib/tenant-context'
import { DashboardShell } from './DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let ctx = null
  try {
    ctx = await getTenantContext()
  } catch {
    redirect('/login')
  }
  if (ctx?.trialExpired) redirect('/trial-expirado')
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
