'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

interface ThemeToggleProps {
  /** Modo compacto: apenas ícone, sem label */
  compact?: boolean
  /** Classe CSS adicional */
  className?: string
}

/**
 * Componente de toggle de tema Light/Dark
 * Usa next-themes para persistir preferência
 *
 * Usa suppressHydrationWarning para evitar mismatch SSR/Client
 * já que o tema só é conhecido no cliente
 */
export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const isDark = resolvedTheme === 'dark'
  const label = isDark ? 'Escuro' : 'Claro'

  // Modo compacto: apenas ícone
  if (compact) {
    return (
      <button
        onClick={mounted ? toggleTheme : undefined}
        disabled={!mounted}
        suppressHydrationWarning
        className={`flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-transparent
          text-[var(--ds-text-secondary)] transition-colors
          hover:border-[var(--ds-border-default)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-primary)]
          disabled:opacity-50 disabled:cursor-wait
          ${className}`}
        aria-label={mounted ? `Alternar para tema ${isDark ? 'claro' : 'escuro'}` : 'Carregando tema'}
        title={mounted ? `Tema: ${label}` : undefined}
      >
        <div className="relative h-4 w-4">
          <Sun
            className="h-4 w-4 absolute inset-0 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
            suppressHydrationWarning
          />
          <Moon
            className="h-4 w-4 absolute inset-0 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
            suppressHydrationWarning
          />
        </div>
      </button>
    )
  }

  // Modo expandido: ícone + label
  return (
    <button
      onClick={mounted ? toggleTheme : undefined}
      disabled={!mounted}
      suppressHydrationWarning
      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors border border-transparent
        hover:bg-[var(--ds-bg-hover)] hover:border-[var(--ds-border-subtle)]
        disabled:opacity-50 disabled:cursor-wait
        ${className}`}
      aria-label={mounted ? `Alternar para tema ${isDark ? 'claro' : 'escuro'}` : 'Carregando tema'}
    >
      <div
        className="w-9 h-9 rounded-full bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] flex items-center justify-center relative"
        suppressHydrationWarning
      >
        <Sun
          className="h-4 w-4 text-[var(--ds-text-secondary)] absolute rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
          suppressHydrationWarning
        />
        <Moon
          className="h-4 w-4 text-[var(--ds-text-secondary)] absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
          suppressHydrationWarning
        />
      </div>
      <span className="text-[var(--ds-text-secondary)]" suppressHydrationWarning>
        {mounted ? `Tema: ${label}` : 'Tema'}
      </span>
    </button>
  )
}
