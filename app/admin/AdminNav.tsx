'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield, Building2, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/admin', label: 'Tenants', icon: Building2 },
  { href: '/admin/plans', label: 'Planos', icon: Layers },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <header className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-bg-elevated)]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-8">
        <Link href="/admin" className="flex items-center gap-2 font-semibold text-[var(--ds-text-primary)]">
          <Shield size={18} className="text-primary-500" aria-hidden="true" />
          <span>Admin</span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Navegação do painel admin">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/admin'
              ? pathname === '/admin'
              : pathname?.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--ds-bg-surface)] text-[var(--ds-text-primary)]'
                    : 'text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-hover)]'
                )}
              >
                <item.icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <Link
          href="/"
          className="ml-auto text-sm text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] transition-colors"
        >
          Voltar ao app
        </Link>
      </div>
    </header>
  )
}
