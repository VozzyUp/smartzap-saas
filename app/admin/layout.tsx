import { redirect } from 'next/navigation'
import { getTenantContext } from '@/lib/tenant-context'
import { AdminNav } from './AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let ctx = null
  try {
    ctx = await getTenantContext()
  } catch {
    redirect('/login')
  }
  if (!ctx?.isPlatformAdmin) redirect('/')

  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] text-[var(--ds-text-primary)]">
      <AdminNav />
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  )
}
