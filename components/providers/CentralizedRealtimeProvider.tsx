'use client'

/**
 * CentralizedRealtimeProvider
 *
 * Centralizes Supabase Realtime subscriptions to avoid multiple channels
 * being created for the same tables. Components can subscribe to table
 * changes through the context instead of creating their own channels.
 *
 * Benefits:
 * - Single channel for all table subscriptions
 * - Debounced invalidations to batch rapid updates
 * - Automatic cleanup on unmount
 * - Reduced Supabase connection overhead
 */

import { createContext, useContext, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabaseBrowser } from '@/lib/supabase'
import { debounce } from '@/lib/utils'

// =============================================================================
// TYPES
// =============================================================================

type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface RealtimeEvent {
  table: string
  eventType: RealtimeEventType
  new: Record<string, unknown> | null
  old: Record<string, unknown> | null
}

type SubscriptionCallback = (event: RealtimeEvent) => void

interface CentralizedRealtimeContextValue {
  /**
   * Subscribe to changes on a table
   * @returns Unsubscribe function
   */
  subscribe: (table: string, callback: SubscriptionCallback) => () => void

  /**
   * Check if realtime is connected
   */
  isConnected: boolean
}

// =============================================================================
// CONTEXT
// =============================================================================

const CentralizedRealtimeContext = createContext<CentralizedRealtimeContextValue | null>(null)

// =============================================================================
// PROVIDER
// =============================================================================

interface CentralizedRealtimeProviderProps {
  children: ReactNode
  /**
   * Tables to subscribe to
   * @default ['campaigns', 'contacts', 'templates', 'flows', 'inbox_conversations', 'inbox_messages']
   */
  tables?: string[]
  /**
   * Debounce time for batching rapid updates (ms)
   * @default 200
   */
  debounceMs?: number
}

export function CentralizedRealtimeProvider({
  children,
  // T072: Added inbox tables for real-time updates
  tables = ['campaigns', 'contacts', 'templates', 'flows', 'inbox_conversations', 'inbox_messages'],
  debounceMs = 200,
}: CentralizedRealtimeProviderProps) {
  const queryClient = useQueryClient()
  const subscribersRef = useRef<Map<string, Set<SubscriptionCallback>>>(new Map())
  const isConnectedRef = useRef(false)
  // Tipo do channel do Supabase Realtime
  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabaseBrowser>>['channel']> | null>(null)

  // Notify all subscribers for a table
  const notifySubscribers = useCallback((table: string, event: RealtimeEvent) => {
    const subs = subscribersRef.current.get(table)
    if (subs && subs.size > 0) {
      subs.forEach(callback => {
        try {
          callback(event)
        } catch (err) {
          console.error(`[CentralizedRealtime] Subscriber error for ${table}:`, err)
        }
      })
    }
  }, [])

  // Debounced query invalidation helper
  // Acumula todas as query keys chamadas dentro da janela de debounce
  // e invalida todas de uma vez. Resolve o bug onde chamadas sequenciais
  // (ex: ['campaigns'] seguido de ['campaignStats']) cancelavam as anteriores.
  const pendingKeysRef = useRef<Set<string>>(new Set())
  const debouncedFlush = useMemo(
    () => debounce(() => {
      const keys = Array.from(pendingKeysRef.current)
      pendingKeysRef.current.clear()
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    }, debounceMs),
    [queryClient, debounceMs]
  )
  const debouncedInvalidate = useCallback((queryKey: string[]) => {
    pendingKeysRef.current.add(queryKey[0])
    debouncedFlush()
  }, [debouncedFlush])

  // Setup realtime channel
  useEffect(() => {
    const supabase = getSupabaseBrowser()
    if (!supabase) {
      // Supabase não configurado - normal durante setup wizard ou se env vars ausentes
      return
    }

    // Create a single channel for all tables
    const channel = supabase.channel('centralized-realtime-v1')
    channelRef.current = channel

    // Subscribe to each table
    tables.forEach(table => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          // media_path é caminho interno do Storage; o app nunca o usa (a UI
          // busca a mídia via /api/inbox/media/[messageId]). Removemos do
          // evento entregue aos subscribers para alinhar com o tipo InboxMessage
          // e não propagar o path internamente.
          const sanitize = (row: Record<string, unknown> | null | undefined) => {
            if (row && table === 'inbox_messages' && 'media_path' in row) {
              const { media_path: _mediaPath, ...rest } = row
              return rest
            }
            return (row ?? null) as Record<string, unknown> | null
          }
          const event: RealtimeEvent = {
            table,
            eventType: payload.eventType as RealtimeEventType,
            new: sanitize(payload.new as Record<string, unknown> | null),
            old: sanitize(payload.old as Record<string, unknown> | null),
          }

          // Notify subscribers
          notifySubscribers(table, event)

          // Default behavior: invalidate related queries
          debouncedInvalidate([table])

          // Also invalidate stats queries
          if (table === 'contacts') {
            debouncedInvalidate(['contactStats'])
            debouncedInvalidate(['contactTags'])
          }
          if (table === 'campaigns') {
            debouncedInvalidate(['campaignStats'])
          }
          // T072: Invalidate inbox queries on inbox table changes
          if (table === 'inbox_conversations') {
            debouncedInvalidate(['inbox-conversations'])
            debouncedInvalidate(['inbox-unread-count'])
          }
          if (table === 'inbox_messages') {
            debouncedInvalidate(['inbox-messages'])
            // Also invalidate unread count when new messages arrive
            debouncedInvalidate(['inbox-unread-count'])
          }
        }
      )
    })

    // Activate channel
    let hasLoggedError = false
    channel.subscribe((status) => {
      isConnectedRef.current = status === 'SUBSCRIBED'
      if (status === 'SUBSCRIBED') {
        hasLoggedError = false // Reset para logar novamente se reconectar e falhar depois
      } else if ((status === 'CLOSED' || status === 'CHANNEL_ERROR') && !hasLoggedError) {
        // Loga apenas uma vez para não poluir o console
        console.warn('[Realtime] Conexão falhou. Tentando reconectar automaticamente...')
        hasLoggedError = true
      }
    })

    // Cleanup
    return () => {
      debouncedFlush.cancel?.()
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      isConnectedRef.current = false
    }
  }, [tables.join(','), notifySubscribers, debouncedInvalidate, debouncedFlush])

  // Subscribe function for consumers
  const subscribe = useCallback((table: string, callback: SubscriptionCallback): (() => void) => {
    if (!subscribersRef.current.has(table)) {
      subscribersRef.current.set(table, new Set())
    }

    subscribersRef.current.get(table)!.add(callback)

    // Return unsubscribe function
    return () => {
      const subs = subscribersRef.current.get(table)
      if (subs) {
        subs.delete(callback)
        if (subs.size === 0) {
          subscribersRef.current.delete(table)
        }
      }
    }
  }, [])

  // Memoize context value to prevent re-renders
  const value = useMemo<CentralizedRealtimeContextValue>(
    () => ({
      subscribe,
      isConnected: isConnectedRef.current,
    }),
    [subscribe]
  )

  return (
    <CentralizedRealtimeContext.Provider value={value}>
      {children}
    </CentralizedRealtimeContext.Provider>
  )
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access centralized realtime functionality
 */
export function useCentralizedRealtime() {
  const ctx = useContext(CentralizedRealtimeContext)
  if (!ctx) {
    throw new Error('useCentralizedRealtime must be used within CentralizedRealtimeProvider')
  }
  return ctx
}

/**
 * Hook to subscribe to a specific table's realtime events
 * Automatically unsubscribes on unmount
 */
export function useRealtimeSubscription(
  table: string,
  callback: SubscriptionCallback,
  enabled = true
) {
  const { subscribe } = useCentralizedRealtime()

  useEffect(() => {
    if (!enabled) return

    const unsubscribe = subscribe(table, callback)
    return unsubscribe
  }, [table, callback, enabled, subscribe])
}
