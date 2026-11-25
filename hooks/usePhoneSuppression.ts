'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { invalidateContacts } from '@/lib/query-invalidation'

export type ActivePhoneSuppression = {
  phone: string
  source: string | null
  reason: string | null
}

export const phoneSuppressionKey = (phone: string) => ['phone-suppression', normalizePhoneNumber(phone)] as const

/** Supressão ativa de um telefone (null se liberado). Usado no cabeçalho do Inbox. */
export function usePhoneSuppression(phone: string | null | undefined) {
  const queryClient = useQueryClient()
  const normalized = phone ? normalizePhoneNumber(phone) : ''

  const query = useQuery({
    queryKey: phoneSuppressionKey(normalized),
    enabled: Boolean(normalized),
    staleTime: 30_000,
    queryFn: async (): Promise<ActivePhoneSuppression | null> => {
      const res = await fetch(`/api/phone-suppressions/${encodeURIComponent(normalized)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Erro ao buscar bloqueio do número')
      const json = await res.json()
      return json?.suppression ?? null
    },
  })

  const release = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/phone-suppressions/${encodeURIComponent(normalized)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Erro ao liberar o número')
    },
    onSuccess: () => {
      queryClient.setQueryData(phoneSuppressionKey(normalized), null)
      queryClient.invalidateQueries({ queryKey: phoneSuppressionKey(normalized) })
      invalidateContacts(queryClient)
      toast.success('Número liberado. A IA volta a responder e ele volta a receber campanhas.')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao liberar o número')
    },
  })

  return {
    suppression: query.data ?? null,
    release: () => release.mutateAsync().catch(() => undefined),
    isReleasing: release.isPending,
  }
}
