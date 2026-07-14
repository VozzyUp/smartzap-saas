/**
 * API para Atendimento - Conversas
 *
 * Retorna conversas no formato otimizado para a página de atendimento.
 * Mapeia InboxConversation → AttendantConversation
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveTenantByAttendantToken } from '@/lib/attendant-auth'
import type { InboxConversation, Contact } from '@/types'

// =============================================================================
// TIPOS
// =============================================================================

export type AttendantConversationStatus = 'ai_active' | 'human_active' | 'handoff_requested' | 'resolved'

export interface AttendantConversation {
  id: string
  contactName: string
  contactPhone: string
  contactAvatar?: string
  status: AttendantConversationStatus
  lastMessage: string
  lastMessageAt: string // ISO string para serialização
  unreadCount: number
  isTyping?: boolean
  aiAgentName?: string
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Mapeia status do inbox para status do atendimento
 */
function mapStatus(conversation: InboxConversation): AttendantConversationStatus {
  // Conversa fechada = resolvida
  if (conversation.status === 'closed') {
    return 'resolved'
  }

  // Se tem priority urgent e está no modo bot, provavelmente pediu handoff
  if (conversation.priority === 'urgent' && conversation.mode === 'bot') {
    return 'handoff_requested'
  }

  // Se tem handoff_summary, também pediu handoff
  if (conversation.handoff_summary && conversation.mode === 'bot') {
    return 'handoff_requested'
  }

  // Mapeia modo diretamente
  if (conversation.mode === 'human') {
    return 'human_active'
  }

  return 'ai_active'
}

/**
 * Transforma InboxConversation em AttendantConversation
 */
function transformConversation(
  conv: InboxConversation & { contact?: Contact | null }
): AttendantConversation {
  return {
    id: conv.id,
    contactName: conv.contact?.name || formatPhoneForDisplay(conv.phone),
    contactPhone: conv.phone,
    contactAvatar: undefined, // Contatos não têm avatar no momento
    status: mapStatus(conv),
    lastMessage: conv.last_message_preview || 'Sem mensagens',
    lastMessageAt: conv.last_message_at || conv.created_at,
    unreadCount: conv.unread_count,
    aiAgentName: conv.ai_agent?.name,
  }
}

/**
 * Formata telefone para exibição
 */
function formatPhoneForDisplay(phone: string): string {
  // Remove o + e formata como (XX) XXXXX-XXXX
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 13) {
    // +55 11 99999-9999
    return `(${cleaned.slice(2, 4)}) ${cleaned.slice(4, 9)}-${cleaned.slice(9)}`
  }
  return phone
}

// =============================================================================
// GET - Lista conversas para o atendimento
// =============================================================================

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      return NextResponse.json({ error: 'Database not available' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const tenantId = await resolveTenantByAttendantToken(token)
    if (!tenantId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const status = searchParams.get('status') // 'open' | 'closed' | null (all)
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')

    // Query base
    let query = supabase
      .from('inbox_conversations')
      .select(`
        *,
        contact:contacts(*),
        ai_agent:ai_agents(id, name)
      `)
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    // Filtro por status
    if (status === 'open') {
      query = query.eq('status', 'open')
    } else if (status === 'closed') {
      query = query.eq('status', 'closed')
    }

    // Filtro por busca (nome do contato ou telefone)
    if (search) {
      query = query.or(`phone.ilike.%${search}%,contact.name.ilike.%${search}%`)
    }

    const { data: conversations, error } = await query

    if (error) {
      console.error('[attendant-api] Error fetching conversations:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Transformar para formato do atendimento
    const attendantConversations = (conversations || []).map(transformConversation)

    // Calcular contadores
    const counts = {
      total: attendantConversations.length,
      urgent: attendantConversations.filter(c => c.status === 'handoff_requested').length,
      ai: attendantConversations.filter(c => c.status === 'ai_active').length,
      human: attendantConversations.filter(c => c.status === 'human_active').length,
      resolved: attendantConversations.filter(c => c.status === 'resolved').length,
    }

    return NextResponse.json({
      conversations: attendantConversations,
      counts,
    })

  } catch (error) {
    console.error('[attendant-api] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
