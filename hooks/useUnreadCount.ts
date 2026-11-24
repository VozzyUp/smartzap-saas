/**
 * T069: Lightweight hook for unread conversations count
 * Used by sidebar to display unread badge without loading full conversation data
 *
 * Realtime: gerenciado pelo CentralizedRealtimeProvider (T072), que já subscreve
 * inbox_conversations e inbox_messages e invalida 'inbox-unread-count' automaticamente.
 * Canal próprio removido para evitar conflito "cannot add postgres_changes after subscribe()".
 */

import { useQuery } from '@tanstack/react-query'

const UNREAD_COUNT_KEY = ['inbox-unread-count']

/**
 * Lightweight hook that returns total count of unread conversations.
 * Realtime updates são recebidas via CentralizedRealtimeProvider.
 */
export function useUnreadCount() {
  const query = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async () => {
      // Contagem no servidor, filtrada pela conta ativa (nunca direto do navegador:
      // sem tenant_id, um administrador da plataforma via a soma de todas as contas).
      const res = await fetch('/api/inbox/unread-count')
      if (!res.ok) {
        console.error('[useUnreadCount] Error fetching count:', res.status)
        return 0
      }
      const data = (await res.json()) as { count?: number }
      return data.count ?? 0
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  return {
    count: query.data ?? 0,
    isLoading: query.isLoading,
  }
}
