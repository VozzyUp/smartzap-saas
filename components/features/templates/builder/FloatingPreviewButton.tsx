'use client'

import React from 'react'
import { Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FloatingPreviewButtonProps {
  onClick: () => void
  className?: string
}

/**
 * Botao flutuante para abrir o preview do template em mobile
 * Posicionado no canto inferior direito, visivel apenas em < lg
 */
export function FloatingPreviewButton({
  onClick,
  className,
}: FloatingPreviewButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Posicionamento fixo
        'fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 sm:right-6 z-40 min-h-11',
        // Visibilidade: apenas mobile (esconde em lg+)
        'lg:hidden',
        // Aparencia
        'flex items-center gap-2 px-4 py-3 rounded-full',
        'bg-emerald-500 hover:bg-emerald-600',
        'text-white font-medium text-sm',
        // Sombra e transicao
        'shadow-lg shadow-emerald-500/25',
        'transition-all duration-200',
        'hover:scale-105 active:scale-95',
        className
      )}
      aria-label="Ver preview do template"
    >
      <Eye className="w-5 h-5" />
      <span>Preview</span>
    </button>
  )
}
