'use client'

import { Toaster } from 'sonner'
import { useTheme } from 'next-themes'

/**
 * Toaster que sincroniza automaticamente com o tema atual
 * Usa next-themes para detectar o tema resolvido
 */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Toaster
      richColors
      position="top-right"
      // PWA no iPhone (black-translucent): desce os avisos para fora da barra de status.
      // mobileOffset só vale em telas pequenas; no computador nada muda.
      mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
    />
  )
}
