'use server'

import { cache } from 'react'
import { headers } from 'next/headers'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { InboxConversation, InboxLabel, InboxQuickReply } from '@/types'

export interface InboxInitialData {
  conversations: InboxConversation[]
  conversationTotal: number
  labels: InboxLabel[]
  quickReplies: InboxQuickReply[]
  totalUnread: number
}

const EMPTY: InboxInitialData = { conversations: [], conversationTotal: 0, labels: [], quickReplies: [], totalUnread: 0 }

/**
 * Busca dados iniciais do inbox no servidor (RSC).
 *
 * Resolve o tenant pelo header `x-tenant-id` injetado pelo middleware (proxy.ts) —
 * fonte robusta, pois o middleware é o único ponto que pode refrescar a sessão e
 * gravar cookies. Server Components NÃO conseguem gravar o cookie de token
 * renovado (setAll é no-op em RSC), então depender de RLS/sessão aqui resultava
 * em lista vazia quando o access token expirava ("Invalid Refresh Token").
 *
 * As queries usam o client admin filtrando explicitamente por tenant_id — mesmo
 * padrão das rotas tenant-scoped da Fase 2C (não dependem de RLS).
 */
export const getInboxInitialData = cache(async (): Promise<InboxInitialData> => {
  const headerStore = await headers()
  const tenantId = headerStore.get('x-tenant-id')
  if (!tenantId) return EMPTY

  const supabase = getSupabaseAdmin()
  if (!supabase) return EMPTY

  // Buscar tudo em paralelo, tudo escopado por tenant
  const [conversationsResult, labelsResult, quickRepliesResult] = await Promise.all([
    // Primeira página de conversas. A contagem permite buscar os próximos lotes.
    supabase
      .from('inbox_conversations')
      .select(`
        *,
        contact:contacts(id, name, phone, email, tags),
        labels:inbox_conversation_labels(
          label:inbox_labels(id, name, color)
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(50),

    // Labels
    supabase
      .from('inbox_labels')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name'),

    // Quick Replies
    supabase
      .from('inbox_quick_replies')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('shortcut')
  ])

  // Mapear conversas - manter snake_case do Supabase
  const conversations: InboxConversation[] = (conversationsResult.data || []).map((conv: any) => ({
    ...conv,
    labels: (conv.labels || [])
      .map((l: any) => l.label)
      .filter(Boolean)
  }))

  // Contar não lidos
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  return {
    conversations,
    conversationTotal: conversationsResult.count ?? conversations.length,
    labels: (labelsResult.data || []) as InboxLabel[],
    quickReplies: (quickRepliesResult.data || []) as InboxQuickReply[],
    totalUnread
  }
})
